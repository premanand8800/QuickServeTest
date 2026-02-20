import { prisma } from "@/lib/db";
import { requireAuth, apiError, apiSuccess, requireRole } from "@/lib/tenant";
import { createOrderSchema, updateOrderStatusSchema } from "@/lib/validations";
import { triggerPusher, EVENTS, tenantChannel } from "@/lib/pusher";
import { nextOrderNumberForTenant } from "@/lib/orders";
import { NextRequest } from "next/server";

function extractChatSessionId(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/CHAT_SESSION:([a-f0-9-]{36})/i);
  return match?.[1] || null;
}

// GET /api/orders — List orders for the tenant
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const status = req.nextUrl.searchParams.get("status");
    const history = req.nextUrl.searchParams.get("history") === "true";
    const includeClosed =
      req.nextUrl.searchParams.get("includeClosed") === "true";
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

    const where: any = { tenantId: session.tenantId };

    if (includeClosed) {
      if (status && status !== "ALL") {
        where.status = status;
      }
    } else if (history) {
      if (status && status !== "ALL") {
        where.status = status;
      } else {
        where.status = { in: ["PAID", "CANCELLED"] };
      }
    } else if (status && status !== "ALL") {
      where.status = status;
    } else {
      where.status = { notIn: ["PAID", "CANCELLED"] };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { menuItem: true } },
          table: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return apiSuccess({ orders, total, page, limit });
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    return apiError("Internal server error", 500);
  }
}

// POST /api/orders — Create a new order
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER", "STAFF");
    const body = await req.json();
    const data = createOrderSchema.parse(body);

    // Fetch menu items to calculate prices
    const menuItemIds = data.items.map((i) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, tenantId: session.tenantId },
    });

    if (menuItems.length !== menuItemIds.length) {
      return apiError("Some menu items not found", 400);
    }

    // Calculate totals
    let subtotal = 0;
    const orderItems = data.items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId)!;
      const total = Number(menuItem.price) * item.quantity;
      subtotal += total;
      return {
        menuItemId: item.menuItemId,
        itemName: menuItem.name,
        unitPrice: menuItem.price,
        quantity: item.quantity,
        total,
        instructions: item.instructions,
      };
    });

    // Get tenant settings for service charge
    // BUG FIX: Tenant.settings is stored as a JSON string in the DB (SQLite has no
    // native JSON type). Casting it directly to `any` means it's still a string,
    // so settings.serviceChargePercent was always undefined and charges were always 0.
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
    });
    let settings: Record<string, any> = {};
    try {
      settings = JSON.parse(tenant?.settings || "{}");
    } catch {
      settings = {};
    }
    const serviceChargePercent = settings.serviceChargePercent || 0;
    const taxPercent = settings.taxPercent || 0;

    const serviceCharge = Math.round(subtotal * (serviceChargePercent / 100));
    const tax = Math.round(subtotal * (taxPercent / 100));
    const total = subtotal + serviceCharge + tax;

    let order: any | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        order = await prisma.$transaction(async (tx) => {
          if (data.tableId) {
            const table = await tx.table.findFirst({
              where: { id: data.tableId!, tenantId: session.tenantId },
            });
            if (!table) {
              throw new Error("TABLE_NOT_FOUND");
            }
            await tx.table.update({
              where: { id: data.tableId! },
              data: { status: "OCCUPIED" },
            });
          }

          const orderNumber = await nextOrderNumberForTenant(
            tx,
            session.tenantId,
          );

          return tx.order.create({
            data: {
              tenantId: session.tenantId,
              orderNumber,
              tableId: data.tableId,
              type: data.type || "DINE_IN",
              notes: data.notes,
              subtotal,
              serviceCharge,
              tax,
              total,
              items: { create: orderItems },
            },
            include: {
              items: { include: { menuItem: true } },
              table: true,
            },
          });
        });
        break;
      } catch (error: any) {
        if (error?.message === "TABLE_NOT_FOUND") throw error;
        if (error?.code === "P2002" && attempt < 2) continue;
        throw error;
      }
    }

    if (!order) return apiError("Could not create order", 500);

    // Broadcast real-time event
    await triggerPusher(tenantChannel(session.tenantId), EVENTS.ORDER_CREATED, {
      order,
    });

    return apiSuccess(order, 201);
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    if (error.message === "TABLE_NOT_FOUND")
      return apiError("Selected table not found", 404);
    if (error.name === "ZodError") return apiError("Validation failed", 400);
    console.error("Order creation error:", error);
    return apiError("Internal server error", 500);
  }
}

// PATCH /api/orders — Update order status
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER", "STAFF");
    const body = await req.json();
    const { orderId, ...rest } = body;

    if (!orderId) return apiError("Order ID required");

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: session.tenantId },
    });
    if (!order) return apiError("Order not found", 404);

    const data = updateOrderStatusSchema.parse(rest);

    const updateData: any = { status: data.status, updatedAt: new Date() };

    // Handle terminal statuses
    if (data.status === "PAID") {
      updateData.paymentStatus = "PAID";
      updateData.completedAt = new Date();
    }
    if (data.status === "CANCELLED") {
      updateData.completedAt = new Date();
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        items: { include: { menuItem: true } },
        table: true,
      },
    });

    // Free up table on terminal status
    if (
      (data.status === "PAID" || data.status === "CANCELLED") &&
      order.tableId
    ) {
      const otherActiveOrders = await prisma.order.count({
        where: {
          tableId: order.tableId,
          status: { notIn: ["PAID", "CANCELLED"] },
          id: { not: orderId },
        },
      });
      if (otherActiveOrders === 0) {
        await prisma.table.update({
          where: { id: order.tableId },
          data: { status: "AVAILABLE" },
        });
      }
    }

    // Broadcast real-time event
    await triggerPusher(
      tenantChannel(session.tenantId),
      EVENTS.ORDER_STATUS_CHANGED,
      { order: updated },
    );

    const chatSessionId = extractChatSessionId(order.notes);
    if (chatSessionId) {
      const paymentLink = `quickserve://pay?order=${encodeURIComponent(updated.orderNumber)}&amount=${Number(updated.total).toFixed(2)}`;
      const statusText: Record<string, string> = {
        CONFIRMED: `Order ${updated.orderNumber} is locked in. I’m your favorite server and I’ve got this. 🍽️`,
        PREPARING: `Chef is cooking ${updated.orderNumber} right now. Smells amazing already. 🔥`,
        READY: `Great news! ${updated.orderNumber} is ready. Wanna pay now? Scan this payment QR: ${paymentLink} ✅`,
        OUT_FOR_DELIVERY: `Your ${updated.orderNumber} is on the way to your table. Want to complete payment? QR: ${paymentLink} 🚀`,
        PAID: `Payment confirmed for ${updated.orderNumber}. You’re a legend. Session closed with a smile. ✅`,
        CANCELLED: `Order ${updated.orderNumber} cancelled. No worries, I’m still here for your next craving. ❌`,
      };
      const text =
        statusText[data.status] ||
        `Order ${updated.orderNumber} status: ${data.status}`;
      await prisma.chatMessage.create({
        data: {
          sessionId: chatSessionId,
          sender: "BOT",
          content: text,
          metadata: JSON.stringify({
            action: `ORDER_${data.status}`,
            orderNumber: updated.orderNumber,
            ...(data.status === "READY" || data.status === "OUT_FOR_DELIVERY"
              ? { paymentLink }
              : {}),
          }),
        },
      });
      if (data.status === "PAID" || data.status === "CANCELLED") {
        await prisma.chatSession.update({
          where: { id: chatSessionId },
          data: { state: "COMPLETED", cart: "[]" },
        });
      }
    }

    return apiSuccess(updated);
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    if (error.name === "ZodError") return apiError("Validation failed", 400);
    console.error("Order update error:", error);
    return apiError("Internal server error", 500);
  }
}
