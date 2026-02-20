import { prisma } from "@/lib/db";
import { requireAuth, apiError, apiSuccess } from "@/lib/tenant";
import { NextRequest } from "next/server";

// GET /api/analytics — Dashboard KPIs
export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        const timeframe = req.nextUrl.searchParams.get("timeframe") || "DAY";
        const tenantId = session.tenantId;

        const now = new Date();
        const msMap: Record<string, number> = {
            DAY: 24 * 60 * 60 * 1000,
            WEEK: 7 * 24 * 60 * 60 * 1000,
            MONTH: 30 * 24 * 60 * 60 * 1000,
            QUARTER: 90 * 24 * 60 * 60 * 1000,
            YEAR: 365 * 24 * 60 * 60 * 1000,
        };

        const threshold = new Date(now.getTime() - (msMap[timeframe] || msMap.DAY));

        // Active orders
        const activeOrders = await prisma.order.count({
            where: { tenantId, status: { notIn: ["PAID", "CANCELLED"] } },
        });

        // Completed (paid) in timeframe
        const completedOrders = await prisma.order.findMany({
            where: {
                tenantId,
                status: "PAID",
                completedAt: { gte: threshold },
            },
            select: { total: true, completedAt: true },
        });

        const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.total), 0);
        const avgOrderValue = completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0;

        // Cancelled in timeframe
        const cancelledCount = await prisma.order.count({
            where: {
                tenantId,
                status: "CANCELLED",
                completedAt: { gte: threshold },
            },
        });

        // Popular items
        const popularItems = await prisma.orderItem.groupBy({
            by: ["itemName"],
            where: {
                order: { tenantId, createdAt: { gte: threshold } },
            },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: "desc" } },
            take: 5,
        });

        // Pending revenue (active orders)
        const pendingOrders = await prisma.order.findMany({
            where: { tenantId, status: { notIn: ["PAID", "CANCELLED"] } },
            select: { total: true },
        });
        const pendingRevenue = pendingOrders.reduce((sum, o) => sum + Number(o.total), 0);

        // Status breakdown
        const statusBreakdown = await prisma.order.groupBy({
            by: ["status"],
            where: { tenantId, createdAt: { gte: threshold } },
            _count: true,
        });

        // Peak hour
        const peakHour = completedOrders.reduce<Record<number, number>>((acc, o) => {
            if (o.completedAt) {
                const hour = new Date(o.completedAt).getHours();
                acc[hour] = (acc[hour] || 0) + 1;
            }
            return acc;
        }, {});

        const peakHourEntry = Object.entries(peakHour).sort((a, b) => b[1] - a[1])[0];

        return apiSuccess({
            activeOrders,
            totalRevenue,
            avgOrderValue,
            pendingRevenue,
            completedCount: completedOrders.length,
            cancelledCount,
            popularItems: popularItems.map((p) => ({
                name: p.itemName,
                count: p._sum.quantity || 0,
            })),
            statusBreakdown: statusBreakdown.reduce((acc, s) => {
                acc[s.status] = s._count;
                return acc;
            }, {} as Record<string, number>),
            peakHour: peakHourEntry ? `${peakHourEntry[0]}:00` : "N/A",
        });
    } catch (error: any) {
        if (error.message === "UNAUTHORIZED") return apiError("Unauthorized", 401);
        console.error("Analytics error:", error);
        return apiError("Internal server error", 500);
    }
}
