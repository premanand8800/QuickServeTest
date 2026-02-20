"use client";

import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { normalizeTableLabel } from "@/lib/tableGroups";

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTableId?: string | null;
}

export default function NewOrderModal({
  isOpen,
  onClose,
  initialTableId = null,
}: NewOrderModalProps) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [selectedBase, setSelectedBase] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [cart, setCart] = useState<any[]>([]);
  const [notes, setNotes] = useState("");
  const [menuSearch, setMenuSearch] = useState("");

  // Fetch tables and menu
  const { data: tablesData } = useQuery({
    queryKey: ["tables"],
    queryFn: async () => (await fetch("/api/tables")).json(),
  });

  const { data: menuData } = useQuery({
    queryKey: ["menu"],
    queryFn: async () =>
      (await fetch(`/api/menu?slug=${session?.user?.tenantSlug}`)).json(),
    enabled: !!session?.user?.tenantSlug,
  });

  const tables = tablesData?.tables || [];
  const normalizedTables = tables
    .map((t: any) => {
      const info = normalizeTableLabel(t.label);
      if (!info) return null;
      return { table: t, ...info };
    })
    .filter(Boolean) as Array<{
    table: any;
    normalized: string;
    baseLabel: string;
    group: string | null;
  }>;

  const baseOptions = Array.from(
    new Set(normalizedTables.map((t) => t.baseLabel)),
  ).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));

  const selectedLabel = selectedBase ? `${selectedBase}${selectedGroup}` : "";
  const selectedTableObj = selectedLabel
    ? normalizedTables.find((t) => t.normalized === selectedLabel)?.table
    : null;
  const selectedTableId = selectedTableObj?.id || "";

  const availableGroups = useMemo(() => {
    if (!selectedBase) return [] as string[];
    const raw = normalizedTables
      .filter((t) => t.baseLabel === selectedBase)
      .map((t) => t.group || "");
    const unique = Array.from(new Set(raw));
    return unique.sort((a, b) => {
      if (a === "" && b !== "") return -1;
      if (b === "" && a !== "") return 1;
      return a.localeCompare(b);
    });
  }, [normalizedTables, selectedBase]);

  const groupMap = Object.fromEntries(
    availableGroups.map((group) => {
      const label = `${selectedBase}${group}`;
      const table =
        normalizedTables.find((t) => t.normalized === label)?.table || null;
      return [
        group,
        {
          exists: !!table,
          occupied: table ? table.orders.length > 0 : false,
          label,
        },
      ];
    }),
  ) as Record<string, { exists: boolean; occupied: boolean; label: string }>;
  const cartQtyMap = cart.reduce(
    (acc, item) => {
      acc[item.id] = (acc[item.id] || 0) + item.qty;
      return acc;
    },
    {} as Record<string, number>,
  );

  const pickBestGroup = (base: string, preferred?: string) => {
    const options = normalizedTables
      .filter((t) => t.baseLabel === base)
      .map((t) => ({
        key: t.group || "",
        occupied: (t.table.orders || []).length > 0,
      }))
      .sort((a, b) => {
        if (a.key === "" && b.key !== "") return -1;
        if (b.key === "" && a.key !== "") return 1;
        return a.key.localeCompare(b.key);
      });

    if (options.length === 0) return "";
    if (preferred && options.some((o) => o.key === preferred)) return preferred;
    const free = options.find((o) => !o.occupied);
    return (free || options[0]).key;
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: selectedTableId || null,
          items: cart.map((item) => ({
            menuItemId: item.id,
            quantity: item.qty,
            instructions: item.instructions || "",
          })),
          type: selectedTableId ? "DINE_IN" : "TAKEAWAY",
          notes,
        }),
      });
      if (!res.ok) throw new Error("Failed to create order");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onClose();
      // Reset form
      setCart([]);
      setSelectedBase("");
      setSelectedGroup("");
      setNotes("");
      setMenuSearch("");
    },
  });

  const addToCart = (item: any) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((i) => i.id !== itemId));
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!initialTableId) {
      setSelectedBase("");
      setSelectedGroup("");
      return;
    }
    const matched = normalizedTables.find((t) => t.table.id === initialTableId);
    if (matched) {
      setSelectedBase(matched.baseLabel);
      setSelectedGroup(matched.group || "");
    }
  }, [isOpen, initialTableId, normalizedTables]);

  useEffect(() => {
    if (!selectedBase) {
      setSelectedGroup("");
      return;
    }
    if (availableGroups.length === 0) {
      setSelectedGroup("");
      return;
    }
    const current = groupMap[selectedGroup];
    if (current?.exists) return;
    setSelectedGroup(pickBestGroup(selectedBase, selectedGroup));
  }, [selectedBase, selectedGroup, availableGroups, normalizedTables]);

  if (!isOpen) return null;

  const total = cart.reduce(
    (sum, item) => sum + Number(item.price) * item.qty,
    0,
  );
  const categories = menuData?.categories || [];

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-7xl h-[92vh] flex flex-col bg-slate-900 border-slate-700">
        <div className="p-4 md:p-5 border-b border-slate-700 flex justify-between items-center bg-slate-900/90 sticky top-0 z-10">
          <div>
            <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight">
              New Order
            </h2>
            <p className="text-[10px] md:text-xs uppercase tracking-[0.2em] text-slate-400 font-bold mt-1">
              Main-Flow Order Composer
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost bg-slate-800 border-slate-700 text-sm px-3"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Left: Menu Selection */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 lg:border-r border-slate-700 custom-scrollbar">
            <div className="space-y-5">
              <div>
                <label className="label">Select Table (Optional)</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
                  <button
                    className={`min-h-[42px] px-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                      !selectedBase
                        ? "bg-primary/15 border-primary/60 text-primary"
                        : "bg-slate-950 border-slate-700 text-slate-300 hover:border-primary/40"
                    }`}
                    onClick={() => {
                      setSelectedBase("");
                      setSelectedGroup("");
                    }}
                  >
                    Takeaway
                  </button>
                  {baseOptions.map((base) => {
                    const occupiedCount = normalizedTables.filter(
                      (t) => t.baseLabel === base && t.table.orders.length > 0,
                    ).length;
                    return (
                      <button
                        key={base}
                        onClick={() => {
                          setSelectedBase(base);
                          setSelectedGroup((prev) => pickBestGroup(base, prev));
                        }}
                        className={`min-h-[42px] px-3 rounded-xl border text-[11px] font-black uppercase tracking-widest relative transition-colors ${
                          selectedBase === base
                            ? "bg-primary/15 border-primary/60 text-primary"
                            : "bg-slate-950 border-slate-700 text-slate-300 hover:border-primary/40"
                        }`}
                      >
                        {base}
                        {occupiedCount > 0 ? (
                          <span className="absolute -top-1 -right-1 px-1 py-[1px] text-[8px] rounded bg-red-500 text-white">
                            {occupiedCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {selectedBase && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {availableGroups.map((group) => {
                      const g = groupMap[group];
                      const active = selectedGroup === group && g.exists;
                      return (
                        <button
                          key={group || "FULL"}
                          disabled={!g.exists}
                          onClick={() => setSelectedGroup(group)}
                          className={`min-h-[42px] px-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                            active
                              ? "bg-blue-500/15 border-blue-400/70 text-blue-200"
                              : !g.exists
                                ? "bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed"
                                : g.occupied
                                  ? "bg-slate-900 border-amber-500/50 text-amber-200 hover:border-amber-300"
                                  : "bg-slate-950 border-slate-700 text-slate-300 hover:border-blue-400/70"
                          }`}
                        >
                          <span>{group || "FULL"}</span>
                          {g.occupied ? (
                            <span className="ml-2 text-[10px] text-amber-300/90">
                              Busy
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  Selected:{" "}
                  <span className="font-mono font-bold text-slate-200">
                    {selectedLabel || "TAKEAWAY"}
                  </span>
                </p>
              </div>

              <div>
                <label className="label">Find Menu Item</label>
                <input
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  className="input bg-slate-950 border-slate-700"
                  placeholder="Search item or category..."
                />
              </div>

              <div className="space-y-5">
                {categories.map((cat: any) => {
                  const items = (cat.items || []).filter((item: any) => {
                    const key = menuSearch.trim().toLowerCase();
                    if (!key) return true;
                    return (
                      String(item.name).toLowerCase().includes(key) ||
                      String(cat.name).toLowerCase().includes(key) ||
                      String(item.description || "")
                        .toLowerCase()
                        .includes(key)
                    );
                  });
                  if (items.length === 0) return null;

                  return (
                    <div key={cat.id}>
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] mb-3 text-primary">
                        {cat.name}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        {items.map((item: any) => (
                          <button
                            key={item.id}
                            onClick={() => addToCart(item)}
                            className={`text-left p-3 rounded-xl border transition-colors group relative ${
                              cartQtyMap[item.id]
                                ? "border-primary/50 ring-1 ring-primary/30 bg-slate-900"
                                : "border-slate-700 hover:border-primary/60 bg-slate-950 hover:bg-slate-900"
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <span className="font-bold text-sm group-hover:text-primary transition-colors">
                                {item.name}
                              </span>
                              <span className="text-xs font-black bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md">
                                Rs.{Number(item.price)}
                              </span>
                            </div>
                            {item.description ? (
                              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                                {item.description}
                              </p>
                            ) : null}
                            {cartQtyMap[item.id] ? (
                              <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                In cart x{cartQtyMap[item.id]}
                              </p>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Cart Summary */}
          <div className="w-full lg:w-[400px] bg-slate-900 p-4 md:p-5 flex flex-col h-full border-t lg:border-t-0 lg:border-l border-slate-700 mt-auto">
            <h3 className="font-black text-lg uppercase tracking-tight mb-4">
              Current Order
            </h3>

            <div className="flex-1 overflow-y-auto space-y-3 mb-4">
              {cart.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-10 border border-dashed border-slate-700 rounded-xl">
                  Select menu items to build order
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center text-sm bg-slate-950 border border-slate-700 rounded-xl p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-slate-700 rounded-lg">
                        <button
                          className="px-2 py-1 hover:bg-slate-800 rounded-l-lg"
                          onClick={() => {
                            if (item.qty > 1) {
                              setCart((prev) =>
                                prev.map((i) =>
                                  i.id === item.id
                                    ? { ...i, qty: i.qty - 1 }
                                    : i,
                                ),
                              );
                            } else {
                              removeFromCart(item.id);
                            }
                          }}
                        >
                          −
                        </button>
                        <span className="px-2 font-bold">{item.qty}</span>
                        <button
                          className="px-2 py-1 hover:bg-slate-800 rounded-r-lg"
                          onClick={() => addToCart(item)}
                        >
                          +
                        </button>
                      </div>
                      <span className="font-medium">{item.name}</span>
                    </div>
                    <span className="font-mono font-semibold">
                      Rs.{Number(item.price) * item.qty}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-700 pt-4 space-y-3">
              {cart.length > 0 && (
                <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                    Selected Items
                  </p>
                  {cart.map((item) => (
                    <div
                      key={`summary-${item.id}`}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-slate-200">
                        {item.name} x{item.qty}
                      </span>
                      <span className="font-mono text-slate-300">
                        Rs.{Number(item.price) * item.qty}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Order notes (optional)..."
                className="input text-sm bg-slate-950 border-slate-700"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="flex justify-between font-black text-lg">
                <span>Total</span>
                <span className="font-mono">Rs. {total}</span>
              </div>

              <button
                onClick={() => createOrder.mutate()}
                disabled={
                  cart.length === 0 ||
                  createOrder.isPending ||
                  (selectedBase.length > 0 && !selectedTableId)
                }
                className="btn-primary w-full py-3 text-sm md:text-base"
              >
                {createOrder.isPending ? "Placing Order..." : "Place Order"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
