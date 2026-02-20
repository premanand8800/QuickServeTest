import { prisma } from "@/lib/db";
import { requireRole, apiError, apiSuccess } from "@/lib/tenant";
import { paymentSchema } from "@/lib/validations";
import { EVENTS, tenantChannel, triggerPusher } from "@/lib/pusher";
import { NextRequest } from "next/server";

function extractChatSessionId(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/CHAT_SESSION:([a-f0-9-]{36})/i);
  return match?.[1] || null;
}

// POST /api/payments — Create a payment record
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER", "STAFF");
    const body = await req.json();
    const data = paymentSchema.parse(body);

    // Verify order belongs to tenant
    const order = await prisma.order.findFirst({
      where: { id: data.orderId, tenantId: session.tenantId },
    });

    if (!order) return apiError("Order not found", 404);
    if (order.paymentStatus === "PAID") return apiError("Already paid", 400);
    if (Math.abs(Number(order.total) - Number(data.amount)) > 0.01) {
      return apiError("Payment amount must match outstanding order total", 400);
    }

    const payment = await prisma.payment.create({
      data: {
        tenantId: session.tenantId,
        orderId: data.orderId,
        amount: data.amount,
        method: data.method as any,
        status: data.method === "CASH" ? "PAID" : "PENDING",
        paidAt: data.method === "CASH" ? new Date() : undefined,
        transactionRef:
          data.method === "CASH" ? `CASH-${Date.now()}` : undefined,
      },
    });

    // If cash, auto-mark order as paid
    if (data.method === "CASH") {
      const updatedOrder = await prisma.order.update({
        where: { id: data.orderId },
        data: {
          paymentStatus: "PAID",
          status: "PAID",
          completedAt: new Date(),
        },
        include: {
          items: true,
          table: true,
        },
      });

      // Free up table
      if (order.tableId) {
        const otherActive = await prisma.order.count({
          where: {
            tableId: order.tableId,
            status: { notIn: ["PAID", "CANCELLED"] },
            id: { not: order.id },
          },
        });
        if (otherActive === 0) {
          await prisma.table.update({
            where: { id: order.tableId },
            data: { status: "AVAILABLE" },
          });
        }
      }

      // Notify linked chat session and close session on payment confirmation.
      const chatSessionId = extractChatSessionId(order.notes);
      if (chatSessionId) {
        await prisma.chatMessage.create({
          data: {
            sessionId: chatSessionId,
            sender: "BOT",
            content: `Payment confirmed for ${updatedOrder.orderNumber}. Smooth move, chef’s kiss service complete. ✅`,
            metadata: JSON.stringify({
              action: "ORDER_PAID",
              orderNumber: updatedOrder.orderNumber,
            }),
          },
        });
        await prisma.chatSession.update({
          where: { id: chatSessionId },
          data: { state: "COMPLETED", cart: "[]" },
        });
      }

      await triggerPusher(
        tenantChannel(session.tenantId),
        EVENTS.ORDER_STATUS_CHANGED,
        { order: updatedOrder },
      );
    }

    return apiSuccess(payment, 201);
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    if (error.name === "ZodError") return apiError("Validation failed", 400);
    console.error("Payment error:", error);
    return apiError("Internal server error", 500);
  }
}

// GET /api/payments — List payments for tenant
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER", "STAFF");
    const orderId = req.nextUrl.searchParams.get("orderId");

    const where: any = { tenantId: session.tenantId };
    if (orderId) where.orderId = orderId;

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      include: { order: { select: { orderNumber: true, total: true } } },
    });

    return apiSuccess({ payments });
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError("Internal server error", 500);
  }
}
