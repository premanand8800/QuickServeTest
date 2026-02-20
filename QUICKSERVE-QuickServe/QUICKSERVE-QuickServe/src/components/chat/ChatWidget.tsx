"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  Loader2,
  Send,
  ShoppingCart,
  Pencil,
  XCircle,
  QrCode,
  CheckCircle2,
} from "lucide-react";

type UiMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  ts?: string;
};

const usedSessionKey = (sessionId: string) => `qs_chat_used_${sessionId}`;

const extractPaymentLink = (text: string): string | null => {
  const match = String(text || "").match(/quickserve:\/\/pay\?[^\s]+/i);
  return match ? match[0] : null;
};

const looksLikeMenuIntent = (text: string): boolean =>
  /(menu|show menu|see menu|what.*available|what.*have|special|recommend|catalog|list items|मेनु|मेन्यू|मेनू|मेनू देखाओ|मेनू दिखाओ|मेनु देखाउ|मेनु देखाऊ)/i.test(
    String(text || ""),
  );

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Prepared",
  OUT_FOR_DELIVERY: "Serving",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  PREPARING: "bg-blue-500/15 border-blue-500/40 text-blue-300",
  READY: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  OUT_FOR_DELIVERY: "bg-violet-500/15 border-violet-500/40 text-violet-300",
  PAID: "bg-primary/20 border-primary/50 text-primary",
  CANCELLED: "bg-red-500/15 border-red-500/40 text-red-300",
};

export default function ChatWidget({
  tenantSlug,
  tableLabel,
  initialSessionId,
  restaurantName,
}: {
  tenantSlug: string;
  tableLabel?: string;
  initialSessionId?: string;
  restaurantName?: string;
}) {
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<
    "BROWSING" | "ORDERING" | "CONFIRMING" | "COMPLETED"
  >("BROWSING");
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: "welcome",
      role: "model",
      text: tableLabel
        ? `Hi, welcome to ${restaurantName || "our restaurant"}. You're ordering for ${tableLabel}.`
        : `Hi, welcome to ${restaurantName || "our restaurant"}. Start by selecting items or typing your order.`,
    },
  ]);
  const [menuPickerOpen, setMenuPickerOpen] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [interactiveCart, setInteractiveCart] = useState<any[]>([]);
  const [editingOrder, setEditingOrder] = useState(false);
  const [orderCardVisible, setOrderCardVisible] = useState(false);
  const [showPaymentQr, setShowPaymentQr] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: menuData } = useQuery({
    queryKey: ["chat-menu", tenantSlug],
    queryFn: async () => {
      const res = await fetch(`/api/menu?slug=${tenantSlug}`);
      if (!res.ok) throw new Error("Failed to fetch menu");
      return res.json();
    },
    staleTime: 30000,
  });

  const { data: sessionData } = useQuery({
    queryKey: ["chat-session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/chat?sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch chat session");
      return res.json();
    },
    enabled: !!sessionId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!initialSessionId || typeof window === "undefined") return;
    const reused = sessionStorage.getItem(usedSessionKey(initialSessionId));
    if (reused) {
      setSessionId(null);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: "For security, that previous session is locked on this device after refresh. Starting a fresh chat now. 🔐",
        },
      ]);
    } else {
      setSessionId(initialSessionId);
      sessionStorage.setItem(usedSessionKey(initialSessionId), "1");
    }
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("session");
    window.history.replaceState({}, "", nextUrl.toString());
  }, [initialSessionId]);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined") return;
    sessionStorage.setItem(usedSessionKey(sessionId), "1");
  }, [sessionId]);

  const linkedOrder = sessionData?.order || null;

  useEffect(() => {
    if (!sessionData) return;
    setSessionState(sessionData.state || "BROWSING");
    const mapped = (sessionData.messages || []).map((m: any) => ({
      id: m.id,
      role: m.sender === "USER" ? "user" : "model",
      text: m.content,
      ts: m.sentAt,
    }));
    if (mapped.length > 0) {
      setMessages(mapped);
    }
  }, [sessionData]);

  useEffect(() => {
    if (!linkedOrder) return;
    setOrderCardVisible(true);
  }, [linkedOrder?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const categoryNames = useMemo(() => {
    const cats = (menuData?.categories || []).map((c: any) => c.name);
    return ["ALL", ...cats];
  }, [menuData]);

  const menuItems = useMemo(() => {
    const categories = menuData?.categories || [];
    const items = categories.flatMap((c: any) =>
      (c.items || []).map((item: any) => ({ ...item, categoryName: c.name })),
    );
    if (selectedCategory === "ALL") return items;
    return items.filter((item: any) => item.categoryName === selectedCategory);
  }, [menuData, selectedCategory]);

  const cartQtyMap = useMemo(
    () =>
      interactiveCart.reduce(
        (acc, item) => {
          acc[item.id] = item.qty;
          return acc;
        },
        {} as Record<string, number>,
      ),
    [interactiveCart],
  );

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(sessionId ? { sessionId } : {}),
          tenantSlug,
          ...(tableLabel ? { tableLabel } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.sessionId) setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: data.message,
          ts: new Date().toISOString(),
        },
      ]);
      if (data.orderPlaced) {
        setInteractiveCart([]);
        setEditingOrder(false);
        setMenuPickerOpen(false);
      }
      if (data.openMenuWizard) {
        setMenuPickerOpen(true);
      }
    },
  });

  const pushUserMessage = (text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        ts: new Date().toISOString(),
      },
    ]);
    sendMessage.mutate(text);
  };

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || sendMessage.isPending || sessionState === "COMPLETED")
      return;
    const text = input.trim();
    setInput("");
    if (looksLikeMenuIntent(text)) {
      setMenuPickerOpen(true);
    }
    pushUserMessage(text);
  };

  const addInteractiveItem = (item: any) => {
    setInteractiveCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [
        ...prev,
        { id: item.id, name: item.name, price: Number(item.price), qty: 1 },
      ];
    });
  };

  const removeInteractiveItem = (itemId: string) => {
    setInteractiveCart((prev) => prev.filter((i) => i.id !== itemId));
  };

  const updateQty = (itemId: string, nextQty: number) => {
    if (nextQty <= 0) {
      removeInteractiveItem(itemId);
      return;
    }
    setInteractiveCart((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, qty: nextQty } : i)),
    );
  };

  const submitInteractive = () => {
    if (interactiveCart.length === 0 || sessionState === "COMPLETED") return;
    const commands = interactiveCart
      .map((i) => `add ${i.name} x${i.qty}`)
      .join(", ");
    const tail =
      linkedOrder || editingOrder ? "and update order" : "and place order";
    const friendly = `${editingOrder ? "Edit" : "Confirm"} order: ${interactiveCart
      .map((i) => `${i.name} x${i.qty}`)
      .join(", ")}`;
    setMenuPickerOpen(false);
    pushUserMessage(friendly);
    sendMessage.mutate(`${commands} ${tail}`);
  };

  const startEditOrder = () => {
    if (!linkedOrder) return;
    const seeded = (linkedOrder.items || []).map((item: any) => ({
      id: item.menuItemId,
      name: item.itemName,
      qty: item.quantity,
      price: Number(item.unitPrice),
    }));
    setInteractiveCart(seeded);
    setEditingOrder(true);
    setMenuPickerOpen(true);
  };

  const cancelOrder = () => {
    if (!linkedOrder || sendMessage.isPending) return;
    pushUserMessage("Cancel my order");
  };

  const confirmPayment = () => {
    if (!linkedOrder || sendMessage.isPending) return;
    setShowPaymentQr(false);
    pushUserMessage("Payment done");
  };

  const restartSession = () => {
    setSessionId(null);
    setSessionState("BROWSING");
    setMessages([
      {
        id: "welcome-reset",
        role: "model",
        text: "New session started. Select items or chat to order.",
      },
    ]);
    setInteractiveCart([]);
    setEditingOrder(false);
    setOrderCardVisible(false);
    setShowPaymentQr(false);
    setMenuPickerOpen(true);
  };

  const interactiveTotal = interactiveCart.reduce(
    (sum, item) => sum + item.qty * Number(item.price),
    0,
  );

  const paymentQrValue = linkedOrder
    ? `quickserve://pay?order=${encodeURIComponent(linkedOrder.orderNumber)}&amount=${Number(linkedOrder.total).toFixed(2)}`
    : "";

  const canPay =
    linkedOrder && ["READY", "OUT_FOR_DELIVERY"].includes(linkedOrder.status);
  const canEditOrCancel =
    linkedOrder && !["PAID", "CANCELLED"].includes(linkedOrder.status);

  return (
    <div className="w-full h-[82dvh] min-h-[560px] max-h-[920px] bg-slate-950/90 border border-slate-700/90 rounded-[1.5rem] md:rounded-[2rem] overflow-hidden shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur">
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] h-full">
        <section className="flex flex-col h-full border-r border-slate-800">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 pb-24 space-y-3 bg-[radial-gradient(circle_at_top,_rgba(7,94,84,0.2),transparent_40%),linear-gradient(180deg,#0f172a,#020617)]"
          >
            {messages.map((msg) => {
              const payLink =
                msg.role === "model" ? extractPaymentLink(msg.text) : null;
              return (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2.5 rounded-2xl text-sm leading-relaxed shadow-md space-y-2 ${
                      msg.role === "user"
                        ? "bg-[#dcf8c6] text-slate-900 rounded-br-sm"
                        : "bg-white text-slate-900 rounded-bl-sm"
                    }`}
                  >
                    <p>{msg.text}</p>
                    {payLink ? (
                      <div className="rounded-lg border border-slate-300 p-2 bg-white">
                        <p className="text-[10px] uppercase tracking-[0.12em] font-black text-slate-500 mb-1">
                          Payment QR
                        </p>
                        <QRCodeSVG value={payLink} size={128} includeMargin />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {sendMessage.isPending && (
              <div className="flex justify-start">
                <div className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 text-slate-900 flex items-center gap-2 text-xs">
                  <Loader2 className="animate-spin" size={13} /> Thinking...
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-20 border-t border-slate-800 p-3 bg-slate-900 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-ghost text-xs px-3 py-1.5 bg-slate-800 border-slate-700"
                onClick={() => setMenuPickerOpen((v) => !v)}
                disabled={sessionState === "COMPLETED"}
              >
                <ShoppingCart size={14} /> {menuPickerOpen ? "Hide" : "Open"}{" "}
                Menu Builder
              </button>
              <div className="flex items-center gap-2">
                {editingOrder ? (
                  <span className="text-[10px] uppercase tracking-[0.14em] font-black text-primary">
                    Edit Mode
                  </span>
                ) : null}
                {sessionState === "COMPLETED" ? (
                  <button
                    type="button"
                    onClick={restartSession}
                    className="btn-accent text-xs px-3 py-1.5"
                  >
                    New Session
                  </button>
                ) : null}
              </div>
            </div>

            <AnimatePresence>
              {menuPickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-3 space-y-3"
                >
                  <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1">
                    {categoryNames.map((category) => (
                      <button
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border whitespace-nowrap ${
                          selectedCategory === category
                            ? "bg-primary/20 border-primary text-primary"
                            : "bg-slate-900 border-slate-700 text-slate-400"
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>

                  <div className="max-h-44 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {menuItems.slice(0, 30).map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => addInteractiveItem(item)}
                        className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                          cartQtyMap[item.id]
                            ? "bg-slate-900 border-primary/60"
                            : "bg-slate-900 border-slate-700 hover:border-primary/50"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-xs font-semibold text-slate-200">
                            {item.name}
                          </span>
                          <span className="text-[11px] font-black text-primary">
                            Rs.{Number(item.price)}
                          </span>
                        </div>
                        {cartQtyMap[item.id] ? (
                          <p className="text-[10px] text-primary mt-1 font-black">
                            Selected x{cartQtyMap[item.id]}
                          </p>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  {interactiveCart.length > 0 && (
                    <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-black">
                        Cart Preview
                      </p>
                      {interactiveCart.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-slate-200">{item.name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, item.qty - 1)}
                              className="w-6 h-6 rounded-md bg-slate-800"
                            >
                              -
                            </button>
                            <span className="font-black w-4 text-center">
                              {item.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, item.qty + 1)}
                              className="w-6 h-6 rounded-md bg-slate-800"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs font-black pt-1 border-t border-slate-700">
                        <span>Total</span>
                        <span>Rs.{interactiveTotal}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-primary w-full text-xs py-2"
                        onClick={submitInteractive}
                        disabled={
                          sendMessage.isPending || sessionState === "COMPLETED"
                        }
                      >
                        {editingOrder || linkedOrder
                          ? "Update Order"
                          : "Confirm Order"}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSend} className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-full px-3 py-2 text-sm focus:outline-none focus:border-primary"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  sessionState === "COMPLETED"
                    ? "Session closed"
                    : "Type your message..."
                }
                disabled={sendMessage.isPending || sessionState === "COMPLETED"}
              />
              <button
                type="submit"
                className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-50"
                disabled={
                  !input.trim() ||
                  sendMessage.isPending ||
                  sessionState === "COMPLETED"
                }
              >
                {sendMessage.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </form>
          </div>
        </section>

        <section className="bg-slate-900 p-4 md:p-5 border-t xl:border-t-0 border-slate-800 min-h-[44vh]">
          <AnimatePresence mode="wait">
            {orderCardVisible && linkedOrder ? (
              <motion.div
                key="order-card"
                initial={{ opacity: 0, x: 20, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.98 }}
                transition={{ duration: 0.28 }}
                className="h-full"
              >
                <div className="bg-slate-950 border border-slate-700 rounded-[1.5rem] overflow-hidden shadow-xl shadow-black/30">
                  <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-start gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-black">
                        Order Card
                      </p>
                      <h3 className="text-2xl font-black tracking-tight mt-1">
                        {linkedOrder.orderNumber}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {linkedOrder.table?.label || "Takeaway"}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-[0.12em] ${
                        STATUS_STYLE[linkedOrder.status] ||
                        "bg-slate-700/20 border-slate-600 text-slate-300"
                      }`}
                    >
                      {STATUS_LABELS[linkedOrder.status] || linkedOrder.status}
                    </span>
                  </div>

                  <div className="px-4 py-3 space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
                    {(linkedOrder.items || []).map((item: any) => (
                      <div
                        key={item.id}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-slate-200">
                          {item.itemName} x{item.quantity}
                        </span>
                        <span className="text-slate-400 font-mono">
                          Rs.
                          {(
                            Number(item.unitPrice) * Number(item.quantity)
                          ).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="px-4 py-3 border-t border-slate-800 space-y-3">
                    <div className="flex justify-between font-black text-sm">
                      <span>Total</span>
                      <span className="font-mono">
                        Rs.{Number(linkedOrder.total).toFixed(2)}
                      </span>
                    </div>

                    {linkedOrder.status === "PAID" ? (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 font-semibold flex items-center gap-2">
                        <CheckCircle2 size={14} /> Payment acknowledged by
                        dashboard.
                      </div>
                    ) : null}

                    {canEditOrCancel ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className="btn-ghost text-xs bg-slate-800 border-slate-700"
                          onClick={startEditOrder}
                          disabled={sendMessage.isPending}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn-danger text-xs"
                          onClick={cancelOrder}
                          disabled={sendMessage.isPending}
                        >
                          <XCircle size={13} /> Cancel
                        </button>
                      </div>
                    ) : null}

                    {canPay ? (
                      <button
                        type="button"
                        className="btn-accent w-full text-xs"
                        onClick={() => setShowPaymentQr(true)}
                      >
                        <QrCode size={14} /> Pay with QR
                      </button>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="chat-only"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="h-full flex items-center justify-center"
              >
                <div className="text-center border border-dashed border-slate-700 rounded-2xl p-6 max-w-sm">
                  <p className="text-sm text-slate-300 font-semibold">
                    Place your order in chat.
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    It will transition into a live order card here with status,
                    edit, cancel, and payment actions.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <AnimatePresence>
        {showPaymentQr && linkedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 10, opacity: 0, scale: 0.98 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-sm"
            >
              <h4 className="text-lg font-black">Scan to Pay</h4>
              <p className="text-xs text-slate-400 mt-1">
                {linkedOrder.orderNumber} • Rs.
                {Number(linkedOrder.total).toFixed(2)}
              </p>
              <div className="bg-white rounded-xl p-3 my-4 flex justify-center">
                <QRCodeSVG value={paymentQrValue} size={220} includeMargin />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setShowPaymentQr(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={confirmPayment}
                >
                  I have paid
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
