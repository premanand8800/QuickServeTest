import { prisma } from "@/lib/db";
import { apiError, apiSuccess, requireRole } from "@/lib/tenant";
import { NextRequest } from "next/server";

// POST /api/chat/session — create a table-linked chat session URL for QR
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER", "STAFF");
    const body = await req.json().catch(() => ({}));

    const tableId = String(body.tableId || "").trim();
    if (!tableId) return apiError("tableId is required", 400);

    const table = await prisma.table.findFirst({
      where: {
        id: tableId,
        tenantId: session.tenantId,
      },
      select: {
        id: true,
        label: true,
      },
    });

    if (!table) return apiError("Table not found", 404);

    const chatSession = await prisma.chatSession.create({
      data: {
        tenantId: session.tenantId,
        state: "BROWSING",
        cart: "[]",
      },
    });

    const urlPath = `/${session.tenantSlug}?table=${encodeURIComponent(table.label)}&session=${chatSession.id}`;

    return apiSuccess({
      sessionId: chatSession.id,
      tableId: table.id,
      tableLabel: table.label,
      urlPath,
    });
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("Chat session create error:", error);
    return apiError("Internal server error", 500);
  }
}
