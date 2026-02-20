"use client";

import { useRef } from "react";
import { format } from "date-fns";
import { useReactToPrint } from "react-to-print";

interface BillModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
}

export default function BillModal({ isOpen, onClose, order }: BillModalProps) {
  const componentRef = useRef<HTMLDivElement>(null);

  // BUG FIX: react-to-print v3 replaced the `content` callback prop with
  // `contentRef` (a plain React ref). Using the old `content: () => ref.current`
  // signature silently fails in v3 — nothing is printed.
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    pageStyle: `
      @page { size: 80mm auto; margin: 0; }
      body { margin: 0; padding: 10px; font-family: monospace; }
      @media print { .no-print { display: none; } }
    `,
  });

  if (!isOpen || !order) return null;

  // Derive actual charge percentages from the order amounts so the bill
  // always reflects the tenant's real settings rather than hardcoded values.
  const svcPercent =
    Number(order.subtotal) > 0
      ? Math.round((Number(order.serviceCharge) / Number(order.subtotal)) * 100)
      : 0;
  const taxPercent =
    Number(order.subtotal) > 0
      ? Math.round((Number(order.tax) / Number(order.subtotal)) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white text-black w-full max-w-[320px] rounded-lg shadow-2xl overflow-hidden animate-slideIn">
        {/* Printable Area - Thermal Printer optimal width is ~80mm */}
        <div
          ref={componentRef}
          className="p-4 font-mono text-sm leading-tight bg-white text-black"
        >
          <div className="text-center border-b-2 border-dashed border-black pb-4 mb-4">
            <h1 className="text-xl font-bold uppercase">QuickServe</h1>
            <p className="text-xs">Kathmandu, Nepal</p>
            <p className="text-xs mt-1">VAT: 123456789</p>
          </div>

          <div className="mb-4 text-xs space-y-1">
            <div className="flex justify-between">
              <span>Order #:</span>
              <span className="font-bold">{order.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{format(new Date(order.createdAt), "dd/MM/yy HH:mm")}</span>
            </div>
            <div className="flex justify-between">
              <span>Table:</span>
              <span>{order.table?.label || "Takeaway"}</span>
            </div>
          </div>

          <div className="border-t border-b border-black py-2 mb-4">
            <div className="grid grid-cols-12 font-bold mb-1 border-b border-gray-300 pb-1">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qt</span>
              <span className="col-span-4 text-right">Amt</span>
            </div>
            {order.items.map((item: any, i: number) => (
              <div key={i} className="grid grid-cols-12 py-1">
                <span className="col-span-6 truncate pr-1">
                  {item.itemName}
                </span>
                <span className="col-span-2 text-center">{item.quantity}</span>
                <span className="col-span-4 text-right">
                  {(Number(item.unitPrice) * item.quantity).toFixed(0)}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-1 text-right text-xs">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>{Number(order.subtotal).toFixed(2)}</span>
            </div>
            {Number(order.serviceCharge) > 0 && (
              <div className="flex justify-between">
                <span>SVC ({svcPercent}%):</span>
                <span>{Number(order.serviceCharge).toFixed(2)}</span>
              </div>
            )}
            {Number(order.tax) > 0 && (
              <div className="flex justify-between">
                <span>VAT ({taxPercent}%):</span>
                <span>{Number(order.tax).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold border-t-2 border-dashed border-black pt-2 mt-2">
              <span>TOTAL:</span>
              <span>Rs. {Number(order.total).toFixed(2)}</span>
            </div>
          </div>

          <div className="text-center mt-6 text-xs border-t border-black pt-2">
            <p>Thank you for visiting!</p>
            <p>Powered by QuickServe</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-3 bg-gray-100 flex gap-2 no-print border-t border-gray-300">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-bold text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 px-4 py-2 text-sm font-bold text-white bg-black rounded hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            <span>🖨️</span> Print Bill
          </button>
        </div>
      </div>
    </div>
  );
}
