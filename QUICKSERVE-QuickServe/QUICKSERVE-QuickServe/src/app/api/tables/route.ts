import { prisma } from "@/lib/db";
import { requireAuth, apiError, apiSuccess, requireRole } from "@/lib/tenant";
import { tableSchema } from "@/lib/validations";
import { NextRequest } from "next/server";
import { buildGroupedLabels, normalizeTableLabel } from "@/lib/tableGroups";

// GET /api/tables — List tables for tenant
export async function GET() {
  try {
    const session = await requireAuth();
    const tables = await prisma.table.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { label: "asc" },
      include: {
        orders: {
          where: { status: { notIn: ["PAID", "CANCELLED"] } },
          select: { id: true, orderNumber: true, status: true },
        },
      },
    });
    return apiSuccess({ tables });
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    return apiError("Internal server error", 500);
  }
}

// POST /api/tables — Create table
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER");
    const body = await req.json();
    const data = tableSchema.parse(body);
    const normalized = normalizeTableLabel(data.label);
    if (!normalized) return apiError("Invalid table label format", 400);

    const groups = Array.isArray(body.groups)
      ? body.groups.map((g: any) => String(g))
      : [];
    const createGrouped = body.createGrouped === true && groups.length > 0;

    if (createGrouped) {
      const labels = buildGroupedLabels(normalized.baseLabel, groups);
      if (labels.length === 0) return apiError("No valid groups provided", 400);

      const created = await prisma.$transaction(async (tx) => {
        const out = [];
        for (const label of labels) {
          const exists = await tx.table.findFirst({
            where: { tenantId: session.tenantId, label },
          });
          if (exists) {
            out.push(exists);
            continue;
          }
          const table = await tx.table.create({
            data: {
              tenantId: session.tenantId,
              label,
              capacity: data.capacity || 4,
            },
          });
          out.push(table);
        }
        return out;
      });
      return apiSuccess({ tables: created }, 201);
    }

    const table = await prisma.table.create({
      data: {
        tenantId: session.tenantId,
        label: normalized.normalized,
        capacity: data.capacity || 4,
      },
    });

    return apiSuccess(table, 201);
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    if (error.name === "ZodError") return apiError("Validation failed", 400);
    if (error.code === "P2002")
      return apiError("Table label already exists", 409);
    return apiError("Internal server error", 500);
  }
}

// PATCH /api/tables — Update table
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole("OWNER", "MANAGER");
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) return apiError("Table ID required");

    const table = await prisma.table.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!table) return apiError("Table not found", 404);

    const allowedFields = ["label", "capacity", "status", "qrCodeUrl"] as const;
    const safeUpdates: Record<string, any> = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        if (key === "label") {
          const normalized = normalizeTableLabel(String(updates[key]));
          if (!normalized) return apiError("Invalid table label format", 400);
          safeUpdates[key] = normalized.normalized;
        } else {
          safeUpdates[key] = updates[key];
        }
      }
    }

    const updated = await prisma.table.update({
      where: { id },
      data: safeUpdates,
    });

    return apiSuccess(updated);
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return apiError("Forbidden", 403);
    if (error.code === "P2002")
      return apiError("Table label already exists", 409);
    return apiError("Internal server error", 500);
  }
}
