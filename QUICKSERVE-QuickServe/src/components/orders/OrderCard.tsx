"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

type OrderCardProps = {
  order: any;
  onStatusChange?: (order: any, nextStatus: string) => void;
  disabled?: boolean;
};

export default function OrderCard({
  order,
  onStatusChange,
  disabled = false,
}: OrderCardProps) {
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const triggerStatus = (status: string) => {
    if (disabled) return;
    if (onStatusChange) {
      onStatusChange(order, status);
      return;
    }
    updateStatus.mutate(status);
  };

  const getBorderColor = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return "border-t-amber-400";
      case "PREPARING":
        return "border-t-blue-500";
      case "READY":
        return "border-t-emerald-500";
      default:
        return "border-t-slate-600";
    }
  };

  const getBadgeClass = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return "badge-confirmed";
      case "PREPARING":
        return "badge-preparing";
      case "READY":
        return "badge-ready";
      default:
        return "badge";
    }
  };

  const isOverdue = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    return diff > 20 * 60 * 1000;
  };

  return (
    <div
      className={`bg-slate-900/60 border border-slate-700 border-t-[10px] ${getBorderColor(order.status)} rounded-[2rem] shadow-2xl shadow-black/30 overflow-hidden h-full flex flex-col ${
        isOverdue(order.createdAt) ? "ring-2 ring-red-500/50" : ""
      }`}
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
        <span className={getBadgeClass(order.status)}>{order.status}</span>
      </div>

      <div className="px-5 py-4 space-y-1.5 min-h-[120px] max-h-[190px] overflow-y-auto custom-scrollbar">
        {order.items.map((item: any) => (
          <div
            key={item.id}
            className="flex justify-between items-start gap-2 text-sm"
          >
            <span className="text-slate-100 font-semibold leading-snug">
              • {item.itemName}{" "}
              <span className="text-primary">x{item.quantity}</span>
            </span>
            <span className="font-mono text-slate-400 whitespace-nowrap">
              Rs. {(Number(item.unitPrice) * item.quantity).toFixed(0)}
            </span>
          </div>
        ))}
      </div>

      {order.notes && (
        <div className="px-5 py-2 text-xs text-slate-400 border-t border-slate-800 italic">
          Note: {order.notes}
        </div>
      )}

      <div className="px-5 py-3 border-t border-slate-800 text-[12px] text-slate-400">
        Total:{" "}
        <span className="font-mono font-black text-slate-100">
          Rs. {Number(order.total).toFixed(2)}
        </span>
      </div>

      <div className="px-4 py-4 bg-slate-900/90 border-t border-slate-800 mt-auto">
        <div className="grid grid-cols-2 gap-2">
          {order.status === "CONFIRMED" && (
            <button
              onClick={() => triggerStatus("PREPARING")}
              disabled={disabled || updateStatus.isPending}
              className="col-span-2 btn-primary"
            >
              Start Cooking
            </button>
          )}
          {order.status === "PREPARING" && (
            <button
              onClick={() => triggerStatus("READY")}
              disabled={disabled || updateStatus.isPending}
              className="col-span-2 btn-success"
            >
              Mark Ready
            </button>
          )}
          {order.status === "READY" && (
            <>
              <button
                onClick={() => triggerStatus("PAID")}
                disabled={disabled || updateStatus.isPending}
                className="btn-accent"
              >
                Paid
              </button>
              <button
                onClick={() => triggerStatus("OUT_FOR_DELIVERY")}
                disabled={disabled || updateStatus.isPending}
                className="btn-ghost bg-slate-800 border-slate-700"
              >
                Serve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
