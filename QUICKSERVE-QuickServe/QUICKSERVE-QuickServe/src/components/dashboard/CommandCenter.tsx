"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { formatDistanceToNow } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { AnimatePresence, motion } from "framer-motion";
import NewOrderModal from "@/components/orders/NewOrderModal";
import BillModal from "@/components/orders/BillModal";
import LiveQrScanner from "@/components/scanner/LiveQrScanner";
import { extractPrimaryTableLabel } from "@/lib/tableGroups";

const ACTIVE_OVERVIEW_STATUSES = [
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
] as const;

async function fetchOrders() {
  const res = await fetch("/api/orders?status=ALL&limit=100");
  if (!res.ok) throw new Error("Failed to fetch orders");
  return res.json();
}

async function fetchAnalytics() {
  const res = await fetch("/api/analytics?timeframe=DAY");
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

async function fetchTables() {
  const res = await fetch("/api/tables");
  if (!res.ok) throw new Error("Failed to fetch tables");
  return res.json();
}

async function fetchHistory() {
  const res = await fetch("/api/orders?history=true&limit=20&page=1");
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: "border-t-amber-400",
  PREPARING: "border-t-blue-500",
  READY: "border-t-emerald-500",
  OUT_FOR_DELIVERY: "border-t-violet-500",
  PAID: "border-t-primary",
  CANCELLED: "border-t-danger",
};

const BADGE_STYLES: Record<string, string> = {
  CONFIRMED: "badge-confirmed",
  PREPARING: "badge-preparing",
  READY: "badge-ready",
  PAID: "badge-paid",
  CANCELLED: "badge-cancelled",
  OUT_FOR_DELIVERY: "badge",
};

const PAYMENT_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  PENDING: "bg-slate-500/20 text-slate-300 border border-slate-500/40",
  FAILED: "bg-red-500/20 text-red-300 border border-red-500/40",
  REFUNDED: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
};

type ViewMode = "ACTIVE" | "MARKET";
type CommandCenterMode = "full" | "kitchen";
type OverviewStatusFilter =
  | "ALL"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY";
const OVERVIEW_STATUS_ORDER: OverviewStatusFilter[] = [
  "ALL",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
];

export default function CommandCenter({
  initialView = "ACTIVE",
  mode = "full",
}: {
  initialView?: ViewMode;
  mode?: CommandCenterMode;
}) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantSlug = (session?.user as any)?.tenantSlug || "";
  const isKitchenMode = mode === "kitchen";
  const [view, setView] = useState<ViewMode>(initialView);

  useEffect(() => {
    setView(isKitchenMode ? "ACTIVE" : initialView);
  }, [initialView, isKitchenMode]);
  const [statusFilter, setStatusFilter] = useState<OverviewStatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [prefillTableId, setPrefillTableId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [scanFeedback, setScanFeedback] = useState("");
  const [billOrder, setBillOrder] = useState<any | null>(null);
  const [qrPayload, setQrPayload] = useState<{
    title: string;
    value: string;
  } | null>(null);

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["orders", "command-center"],
    queryFn: fetchOrders,
    refetchInterval: 10000,
  });
  const { data: analytics } = useQuery({
    queryKey: ["analytics", "DAY", "command-center"],
    queryFn: fetchAnalytics,
    refetchInterval: 30000,
    enabled: !isKitchenMode || view === "MARKET",
  });
  const { data: tablesData } = useQuery({
    queryKey: ["tables", "command-center"],
    queryFn: fetchTables,
    refetchInterval: 20000,
  });
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["orders", "history", "quick-modal"],
    queryFn: fetchHistory,
    enabled: showHistory && !isKitchenMode,
  });

  const orders = ordersData?.orders || [];
  const tables = tablesData?.tables || [];
  const activeCoreOrders = useMemo(
    () =>
      orders.filter((order: any) =>
        ACTIVE_OVERVIEW_STATUSES.includes(order.status as any),
      ),
    [orders],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<OverviewStatusFilter, number> = {
      ALL: activeCoreOrders.length,
      CONFIRMED: 0,
      PREPARING: 0,
      READY: 0,
      OUT_FOR_DELIVERY: 0,
    };
    for (const order of activeCoreOrders) {
      const status = order.status as OverviewStatusFilter;
      if (counts[status] !== undefined) counts[status] += 1;
    }
    return counts;
  }, [activeCoreOrders]);
  const activeOrders = useMemo(() => {
    const keyword = search.toLowerCase().trim();
    const isSearchMatch = (order: any) =>
      !keyword
        ? true
        : String(order.orderNumber).toLowerCase().includes(keyword) ||
          String(order.table?.label || "takeaway")
            .toLowerCase()
            .includes(keyword);

    const activeCore = orders.filter((order: any) => {
      if (!ACTIVE_OVERVIEW_STATUSES.includes(order.status as any)) {
        return false;
      }
      const statusMatch =
        statusFilter === "ALL" ? true : order.status === statusFilter;
      return statusMatch && isSearchMatch(order);
    });

    return activeCore;
  }, [orders, search, statusFilter]);

  const updateStatus = useMutation({
    mutationFn: async (payload: { orderId: string; status: string }) => {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update order status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["orders", "history"] });
    },
  });

  const payCash = useMutation({
    mutationFn: async (order: any) => {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          method: "CASH",
          amount: Number(order.total),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to mark cash payment");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["orders", "history"] });
    },
  });

  const openOrderQr = (order: any) => {
    const origin = window.location.origin;
    const tableLabel = order.table?.label || "TAKEAWAY";
    const url = `${origin}/${tenantSlug}?table=${encodeURIComponent(tableLabel)}`;
    setQrPayload({
      title: `Order QR - ${order.orderNumber}`,
      value: url,
    });
  };

  const openPaymentQr = (order: any) => {
    const payload = `quickserve://pay?order=${encodeURIComponent(order.orderNumber)}&amount=${Number(order.total).toFixed(2)}`;
    setQrPayload({
      title: `Payment QR - ${order.orderNumber}`,
      value: payload,
    });
  };

  const normalizeScannedValue = (value: string) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const tableDirect = extractPrimaryTableLabel(raw);
    if (tableDirect) return tableDirect.toUpperCase();

    const orderDirect = raw.match(/\bQS-\d+\b/i)?.[0];
    if (orderDirect) return orderDirect.toUpperCase();

    try {
      if (raw.includes("://")) {
        const parsed = new URL(raw);
        const tableParam = parsed.searchParams.get("table");
        if (tableParam) {
          const table = extractPrimaryTableLabel(tableParam);
          if (table) return table.toUpperCase();
        }
        const orderParam = parsed.searchParams.get("order");
        if (orderParam) return String(orderParam).toUpperCase();
      }
    } catch {
      // ignore malformed URLs
    }

    return raw.toUpperCase();
  };

  const handleScanResolve = (rawOverride?: string) => {
    const raw = (rawOverride ?? scanValue).trim();
    if (!raw) return;
    const normalized = normalizeScannedValue(raw);
    setScanValue(normalized);

    const order = orders.find(
      (o: any) =>
        String(o.orderNumber).toUpperCase() === normalized ||
        String(o.id).toUpperCase() === normalized,
    );
    if (order) {
      setSearch(order.orderNumber);
      setScanFeedback(`Matched order ${order.orderNumber}.`);
      return;
    }

    const table = tables.find(
      (t: any) => String(t.label).toUpperCase() === normalized,
    );
    if (table) {
      const tableHasActive = (table.orders || []).length > 0;
      if (tableHasActive) {
        setSearch(table.label);
        setScanFeedback(`Table ${table.label} has an active order.`);
      } else {
        setPrefillTableId(table.id);
        setShowNewOrder(true);
        setScanModalOpen(false);
        setScanValue("");
        setScanFeedback("");
      }
      return;
    }

    setScanFeedback(`No table/order found for "${normalized}".`);
  };

  const activeCount = analytics?.activeOrders ?? activeCoreOrders.length;
  const occupiedCount = tables.filter(
    (t: any) => t.status === "OCCUPIED",
  ).length;
  const availableCount = tables.filter(
    (t: any) => t.status === "AVAILABLE",
  ).length;
  const actionBusy = updateStatus.isPending || payCash.isPending;

  return (
    <div className="space-y-4">
      <header className="bg-slate-900 border border-slate-700 rounded-[2rem] p-4 md:p-5 shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-xl shadow-orange-900/40 border-b-2 border-orange-800">
              <span className="text-white text-xl">🔥</span>
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight leading-none">
                QuickServe
              </h1>
              <p className="text-[10px] md:text-xs text-text-muted uppercase tracking-[0.18em] mt-1 font-black">
                {isKitchenMode
                  ? "Kitchen Ticket Board"
                  : "Kitchen Command Center"}
              </p>
            </div>
          </div>

          {!isKitchenMode ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setScanModalOpen(true)}
                className="btn-ghost"
              >
                Scan
              </button>
              <button
                onClick={() => setShowHistory(true)}
                className="btn-ghost"
              >
                History
              </button>
              <button
                onClick={() => {
                  setPrefillTableId(null);
                  setShowNewOrder(true);
                }}
                className="btn-primary"
              >
                New Order
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div
            className={`grid gap-2 w-full lg:w-auto ${
              isKitchenMode
                ? "grid-cols-1 sm:grid-cols-3 md:grid-cols-4"
                : "grid-cols-2 md:grid-cols-4"
            }`}
          >
            <div className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                Active
              </p>
              <p className="text-xl font-black text-white">{activeCount}</p>
            </div>
            <div className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                Occupied
              </p>
              <p className="text-xl font-black text-white">{occupiedCount}</p>
            </div>
            <div className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                Available
              </p>
              <p className="text-xl font-black text-white">{availableCount}</p>
            </div>
            {!isKitchenMode ? (
              <div className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                  Revenue
                </p>
                <p className="text-xl font-black text-emerald-400">
                  Rs. {(analytics?.totalRevenue ?? 0).toLocaleString()}
                </p>
              </div>
            ) : null}
          </div>

          {!isKitchenMode ? (
            <div className="flex bg-slate-800 rounded-2xl p-1 border border-slate-700">
              <button
                onClick={() => setView("ACTIVE")}
                className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] ${
                  view === "ACTIVE"
                    ? "bg-slate-700 text-white shadow-lg"
                    : "text-slate-400"
                }`}
              >
                Kitchen
              </button>
              <button
                onClick={() => setView("MARKET")}
                className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] ${
                  view === "MARKET"
                    ? "bg-slate-700 text-white shadow-lg"
                    : "text-slate-400"
                }`}
              >
                Analytics
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {view === "ACTIVE" || isKitchenMode ? (
        <>
          <section className="bg-slate-900/70 border border-slate-700 rounded-[1.5rem] p-4">
            <div className="flex flex-col md:flex-row gap-3">
              <input
                className="input md:max-w-sm bg-slate-950 border-slate-700"
                placeholder="Search by order number or table..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {!isKitchenMode ? (
                <div className="flex gap-2 ml-auto">
                  <Link
                    href="/dashboard/menu"
                    className="btn-ghost bg-slate-800 border-slate-700"
                  >
                    Menu
                  </Link>
                  <Link
                    href="/dashboard/tables"
                    className="btn-ghost bg-slate-800 border-slate-700"
                  >
                    Tables
                  </Link>
                  <Link
                    href="/dashboard/settings"
                    className="btn-ghost bg-slate-800 border-slate-700"
                  >
                    Settings
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="mt-3 filter-bar">
              {OVERVIEW_STATUS_ORDER.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`filter-chip ${statusFilter === status ? "filter-chip-active" : ""}`}
                >
                  <span>{status.replaceAll("_", " ")}</span>
                  <span className="filter-chip-count">
                    {statusCounts[status] || 0}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {ordersLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-slate-900/50 border border-slate-700 rounded-[2rem] h-[360px] animate-pulse"
                />
              ))}
            </div>
          ) : activeOrders.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-700 rounded-[2rem] text-center py-20">
              <p className="text-slate-400 text-sm font-bold uppercase tracking-[0.2em]">
                No Active Orders
              </p>
            </div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {activeOrders.map((order: any) => (
                  <motion.article
                    layout
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{
                      opacity: 0,
                      y: -8,
                      scale: 0.96,
                      filter: "blur(2px)",
                      transition: { duration: 0.9, ease: "easeOut" },
                    }}
                    key={order.id}
                    className={`bg-slate-900/60 border border-slate-700 border-t-[10px] ${STATUS_STYLES[order.status] || "border-t-slate-700"} rounded-[2rem] shadow-2xl shadow-black/30 overflow-hidden`}
                  >
                    <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-start gap-3">
                      <div>
                        <h3 className="font-black text-2xl tracking-tight leading-none">
                          {order.orderNumber}
                        </h3>
                        <p className="text-[11px] text-slate-400 uppercase tracking-widest mt-1 font-bold">
                          {order.table?.label || "TAKEAWAY"} •{" "}
                          {formatDistanceToNow(new Date(order.createdAt), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span
                          className={`badge ${BADGE_STYLES[order.status] || "badge"}`}
                        >
                          {order.status}
                        </span>
                        {!isKitchenMode ? (
                          <span
                            className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider ${PAYMENT_STYLES[order.paymentStatus] || PAYMENT_STYLES.PENDING}`}
                          >
                            {order.paymentStatus}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="px-5 py-4 min-h-[120px] max-h-[180px] overflow-y-auto custom-scrollbar space-y-1.5">
                      {order.items.map((item: any) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-start gap-2 text-sm"
                        >
                          <span className="text-slate-100 font-semibold leading-snug">
                            • {item.itemName}{" "}
                            <span className="text-primary">
                              x{item.quantity}
                            </span>
                          </span>
                          <span className="font-mono text-slate-400 whitespace-nowrap">
                            Rs.{" "}
                            {(Number(item.unitPrice) * item.quantity).toFixed(
                              0,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="px-5 py-3 border-t border-slate-800 text-[12px] text-slate-400">
                      Total:{" "}
                      <span className="font-mono font-black text-slate-100">
                        Rs. {Number(order.total).toFixed(2)}
                      </span>
                    </div>
                    <div className="px-4 py-4 bg-slate-900/90 border-t border-slate-800">
                      <div
                        className={`grid gap-2 ${isKitchenMode ? "grid-cols-1" : "grid-cols-2"}`}
                      >
                        {order.status === "CONFIRMED" && (
                          <button
                            className="btn-primary col-span-2"
                            disabled={actionBusy}
                            onClick={() =>
                              updateStatus.mutate({
                                orderId: order.id,
                                status: "PREPARING",
                              })
                            }
                          >
                            Start Cooking
                          </button>
                        )}
                        {order.status === "PREPARING" && (
                          <button
                            className="btn-success col-span-2"
                            disabled={actionBusy}
                            onClick={() =>
                              updateStatus.mutate({
                                orderId: order.id,
                                status: "READY",
                              })
                            }
                          >
                            Mark Ready
                          </button>
                        )}
                        {order.status === "READY" &&
                          (isKitchenMode ? (
                            <button
                              className="btn-ghost bg-slate-800 border-slate-700 col-span-2"
                              disabled={actionBusy}
                              onClick={() =>
                                updateStatus.mutate({
                                  orderId: order.id,
                                  status: "OUT_FOR_DELIVERY",
                                })
                              }
                            >
                              Serve
                            </button>
                          ) : (
                            <>
                              <button
                                className="btn-ghost bg-slate-800 border-slate-700"
                                disabled={actionBusy}
                                onClick={() =>
                                  updateStatus.mutate({
                                    orderId: order.id,
                                    status: "OUT_FOR_DELIVERY",
                                  })
                                }
                              >
                                Serve
                              </button>
                              <button
                                className="btn-accent"
                                disabled={actionBusy}
                                onClick={() => payCash.mutate(order)}
                              >
                                Cash Paid
                              </button>
                            </>
                          ))}
                        {order.status === "OUT_FOR_DELIVERY" &&
                          !isKitchenMode && (
                            <button
                              className="btn-accent col-span-2"
                              disabled={actionBusy}
                              onClick={() => payCash.mutate(order)}
                            >
                              Complete Payment
                            </button>
                          )}
                        {!isKitchenMode ? (
                          <>
                            <button
                              className="btn-ghost bg-slate-800 border-slate-700"
                              onClick={() => setBillOrder(order)}
                            >
                              Bill
                            </button>
                            <button
                              className="btn-ghost bg-slate-800 border-slate-700"
                              onClick={() => openOrderQr(order)}
                            >
                              Order QR
                            </button>
                            <button
                              className="btn-ghost bg-slate-800 border-slate-700"
                              onClick={() => openPaymentQr(order)}
                            >
                              Payment QR
                            </button>
                            {[
                              "CONFIRMED",
                              "PREPARING",
                              "READY",
                              "OUT_FOR_DELIVERY",
                            ].includes(order.status) && (
                              <button
                                className="btn-danger"
                                disabled={actionBusy}
                                onClick={() =>
                                  updateStatus.mutate({
                                    orderId: order.id,
                                    status: "CANCELLED",
                                  })
                                }
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </>
      ) : (
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="stat-card bg-slate-900 border-slate-700">
              <span className="stat-label text-slate-400">
                Total Revenue Today
              </span>
              <span className="stat-value text-emerald-400">
                Rs. {(analytics?.totalRevenue ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="stat-card bg-slate-900 border-slate-700">
              <span className="stat-label text-slate-400">Pending Revenue</span>
              <span className="stat-value text-amber-400">
                Rs. {(analytics?.pendingRevenue ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="stat-card bg-slate-900 border-slate-700">
              <span className="stat-label text-slate-400">
                Completed Orders
              </span>
              <span className="stat-value text-primary">
                {analytics?.completedCount ?? 0}
              </span>
            </div>
            <div className="stat-card bg-slate-900 border-slate-700">
              <span className="stat-label text-slate-400">Peak Hour</span>
              <span className="stat-value">{analytics?.peakHour ?? "N/A"}</span>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700 rounded-[1.5rem] p-4">
            <h3 className="font-bold mb-3 uppercase tracking-wider text-sm">
              Popular Items
            </h3>
            {!analytics?.popularItems?.length ? (
              <p className="text-sm text-slate-400">No data available yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                {analytics.popularItems.map((item: any) => (
                  <div
                    key={item.name}
                    className="bg-slate-950 border border-slate-700 rounded-xl p-3"
                  >
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Ordered {item.count} time(s)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {!isKitchenMode && showNewOrder && (
        <NewOrderModal
          isOpen={showNewOrder}
          onClose={() => {
            setShowNewOrder(false);
            setPrefillTableId(null);
          }}
          initialTableId={prefillTableId}
        />
      )}

      {!isKitchenMode && billOrder && (
        <BillModal
          isOpen={!!billOrder}
          order={billOrder}
          onClose={() => setBillOrder(null)}
        />
      )}

      {!isKitchenMode && qrPayload && (
        <div className="modal-overlay" onClick={() => setQrPayload(null)}>
          <div
            className="modal-content max-w-sm p-5 bg-slate-900 border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-black mb-3 uppercase tracking-wide">
              {qrPayload.title}
            </h3>
            <div className="bg-white rounded-lg p-3 w-fit mx-auto">
              <QRCodeSVG value={qrPayload.value} size={210} includeMargin />
            </div>
            <p className="text-xs text-slate-400 break-all mt-3 font-mono">
              {qrPayload.value}
            </p>
            <button
              className="btn-ghost w-full mt-4 bg-slate-800 border-slate-700"
              onClick={() => setQrPayload(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {!isKitchenMode && showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div
            className="modal-content max-w-3xl p-5 bg-slate-900 border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-lg uppercase tracking-wide">
                Recent Completed / Cancelled Orders
              </h3>
              <button
                className="btn-ghost bg-slate-800 border-slate-700"
                onClick={() => setShowHistory(false)}
              >
                Close
              </button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-slate-400">Loading history...</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
                {(historyData?.orders || []).map((order: any) => (
                  <div
                    key={order.id}
                    className="bg-slate-950 border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-mono font-semibold">
                        {order.orderNumber}
                      </p>
                      <p className="text-xs text-slate-400">
                        {order.table?.label || "TAKEAWAY"} •{" "}
                        {formatDistanceToNow(new Date(order.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-bold">
                        Rs. {Number(order.total).toFixed(2)}
                      </p>
                      <span
                        className={`badge ${BADGE_STYLES[order.status] || "badge"}`}
                      >
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <Link
                href="/dashboard/history"
                className="btn-primary w-full inline-flex justify-center"
              >
                Open Full History
              </Link>
            </div>
          </div>
        </div>
      )}

      {!isKitchenMode && scanModalOpen && (
        <div className="modal-overlay" onClick={() => setScanModalOpen(false)}>
          <div
            className="modal-content max-w-xl p-5 bg-slate-900 border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-black text-lg mb-2 uppercase tracking-wide">
              QR / Scanner Input
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              Paste/scan a table label (example:{" "}
              <span className="font-mono">T-01</span>) or order number (example:{" "}
              <span className="font-mono">QS-000123</span>).
            </p>
            <div className="mb-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
              <LiveQrScanner
                onDetected={(value) => {
                  const normalized = normalizeScannedValue(value);
                  if (!normalized) return;
                  setScanValue(normalized);
                  handleScanResolve(normalized);
                }}
              />
            </div>
            <input
              className="input bg-slate-950 border-slate-700"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              placeholder="Scan value..."
            />
            {scanFeedback && (
              <div className="mt-3 text-xs rounded-lg border border-slate-700 bg-slate-950 p-3 text-slate-300">
                {scanFeedback}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button
                className="btn-primary flex-1"
                onClick={() => handleScanResolve()}
              >
                Resolve
              </button>
              <button
                className="btn-ghost flex-1 bg-slate-800 border-slate-700"
                onClick={() => setScanModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
