
import React, { useState, useEffect, useCallback, useRef } from 'react';
import OrderGrid from './components/OrderGrid';
import NewOrderModal from './components/NewOrderModal';
import MarketInsights from './components/MarketInsights';
import HistoryModal from './components/HistoryModal';
import BillModal from './components/BillModal';
import QRModal from './components/QRModal';
import QRScanner from './components/QRScanner';
import Toast from './components/Toast';
import { Order, OrderStatus, ActionType, ConnectionHealth, TableTracking } from './types';
import {
  ORDER_POLL_INTERVAL,
  HEARTBEAT_INTERVAL,
  N8N_ENDPOINTS,
  DEFAULT_MENU
} from './constants';
import * as api from './services/api';

const App: React.FC = () => {
  // ─── CORE STATE ──────────────────────────────────────
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState(DEFAULT_MENU);
  const [activeTab, setActiveTab] = useState<'KITCHEN' | 'ANALYTICS'>('KITCHEN');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const heartbeatRef = useRef(0);

  // Persistence for history and table tracking (local state)
  const [historyOrders, setHistoryOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('qs_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [tableTracking, setTableTracking] = useState<Record<string, TableTracking>>({});

  // ─── MODAL STATE ─────────────────────────────────────
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isStationScannerOpen, setIsStationScannerOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [viewingBillOrder, setViewingBillOrder] = useState<Order | null>(null);
  const [viewingQR, setViewingQR] = useState<{ type: 'ORDER' | 'PAYMENT', tableId: string, orderId?: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

  // ─── CONNECTION STATE ────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rawDebugData, setRawDebugData] = useState<string>('');
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>({
    fetching: false,
    menu: false,
    updating: false,
  });
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ─── PERSISTENCE SYNC ────────────────────────────────
  useEffect(() => {
    localStorage.setItem('qs_history', JSON.stringify(historyOrders));
  }, [historyOrders]);

  // ─── TOAST ───────────────────────────────────────────
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // ─── MENU FETCH (Cache-First) ────────────────────────
  const fetchMenuData = useCallback(async () => {
    const result = await api.fetchMenu();
    if (result.success && result.data && result.data.length > 0) {
      setMenu(result.data);
      setConnectionHealth(prev => ({ ...prev, menu: true }));
    } else {
      setConnectionHealth(prev => ({ ...prev, menu: false }));
    }
  }, []);

  // ─── ORDER FETCH ─────────────────────────────────────
  const fetchOrderData = useCallback(async () => {
    const result = await api.fetchOrders();

    if (result.success) {
      setConnectionHealth(prev => ({
        ...prev,
        fetching: true,
        lastSuccessfulFetch: Date.now(),
      }));
      setLastError(null);
      setRawDebugData(`Status: OK\nOrders: ${result.data?.length || 0}\nTime: ${new Date().toLocaleTimeString()}`);

      if (result.data && result.data.length > 0) {
        setOrders(prev => {
          const orderMap = new Map<string, Order>(prev.map(o => [o.order_id, o]));
          result.data!.forEach(mapped => {
            orderMap.set(mapped.order_id, mapped);
          });
          return Array.from(orderMap.values())
            .filter(o => o.status !== OrderStatus.PAID && o.status !== OrderStatus.CANCELLED)
            .sort((a, b) => b.order_id.localeCompare(a.order_id));
        });

        // Emit event
        api.emitEvent('order.updated', { count: result.data.length });
      }
    } else {
      setConnectionHealth(prev => ({ ...prev, fetching: false, lastError: result.error }));
      const errorMsg = result.error?.includes('CORS') || result.error?.includes('Network')
        ? 'Failed to Fetch (CORS/Network Blocked)'
        : result.error || 'Unknown error';
      setLastError(errorMsg);
      setRawDebugData(`Error: ${errorMsg}\nTime: ${new Date().toLocaleTimeString()}`);
    }

    setIsInitialLoad(false);
  }, []);

  // ─── POLLING + HEARTBEAT ─────────────────────────────
  useEffect(() => {
    fetchMenuData();
    fetchOrderData();

    const orderInterval = setInterval(fetchOrderData, ORDER_POLL_INTERVAL);
    const heartbeat = setInterval(() => {
      heartbeatRef.current++;
      api.emitEvent('system.heartbeat', { tick: heartbeatRef.current });
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(orderInterval);
      clearInterval(heartbeat);
    };
  }, [fetchOrderData, fetchMenuData]);

  // ─── ACTION HANDLER (State Machine) ──────────────────
  const handleAction = async (table_or_order_id: string, action: ActionType) => {
    const order = orders.find(o => o.table_id === table_or_order_id || o.order_id === table_or_order_id);
    if (!order) return;

    // UI-only actions
    if (action === 'UPDATE_ORDER') { setEditingOrder(order); return; }
    if (action === 'SHOW_BILL') { setViewingBillOrder(order); return; }
    if (action === 'SHOW_QR') { setViewingQR({ type: 'ORDER', tableId: order.table_id }); return; }
    if (action === 'SHOW_PAYMENT_QR') { setViewingQR({ type: 'PAYMENT', tableId: order.table_id, orderId: order.order_id }); return; }

    // Determine next status
    const beforeState = { ...order };
    let nextStatus = order.status;
    let nextPayment = order.payment_status;

    if (action === 'MARK_PREPARING') nextStatus = OrderStatus.PREPARING;
    if (action === 'MARK_READY') nextStatus = OrderStatus.READY;
    if (action === 'MARK_COMPLETED') nextStatus = OrderStatus.COMPLETED;
    if (action === 'PROCESS_PAYMENT' || action === 'MARK_PAID') {
      nextStatus = OrderStatus.PAID;
      nextPayment = 'PAID';
    }
    if (action === 'CANCEL_ORDER' || action === 'OUT_OF_STOCK') {
      nextStatus = OrderStatus.CANCELLED;
    }

    setIsLoading(true);

    try {
      const result = await api.updateOrder({
        order_id: order.order_id,
        table_id: order.table_id,
        status: nextStatus,
        payment_status: nextPayment,
      });

      if (result.success) {
        // Optimistic update
        setOrders(prev => prev.map(o =>
          o.order_id === order.order_id
            ? { ...o, status: nextStatus, payment_status: nextPayment }
            : o
        ));
        setConnectionHealth(prev => ({ ...prev, updating: true }));
        showToast(`${nextStatus} SYNCED`);

        // Record audit
        api.recordAudit({
          entity_type: 'order',
          entity_id: order.order_id,
          actor: 'staff',
          action: action,
          before_state: beforeState,
          after_state: { ...order, status: nextStatus, payment_status: nextPayment },
        });

        // Emit event
        api.emitEvent('order.status_changed', {
          order_id: order.order_id,
          from: order.status,
          to: nextStatus
        });

        // Move to history on terminal states
        if (['PROCESS_PAYMENT', 'CANCEL_ORDER', 'MARK_PAID'].includes(action)) {
          setTimeout(() => {
            setHistoryOrders(prev => [{
              ...order,
              status: nextStatus,
              payment_status: nextPayment,
              completed_at: new Date().toISOString()
            }, ...prev]);
            setOrders(prev => prev.filter(o => o.order_id !== order.order_id));
          }, 1000);
        }
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err: any) {
      setConnectionHealth(prev => ({ ...prev, updating: false }));
      const msg = err.message?.includes('CORS') || err.message?.includes('Network')
        ? 'CORS/NETWORK BLOCK'
        : 'SYNC FAILED';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── QR SCANNER ──────────────────────────────────────
  const handleGlobalScan = (data: string) => {
    setIsStationScannerOpen(false);
    const normalized = data.toUpperCase();
    const existing = orders.find(o => o.table_id === normalized || o.order_id === normalized);

    if (existing) {
      setEditingOrder(existing);
    } else if (normalized.startsWith('T-')) {
      setIsNewOrderModalOpen(true);
    }
  };

  // ─── ORDER CREATION ──────────────────────────────────
  const handleCreateSuccess = (msg: string, order: Order) => {
    setOrders(prev => [order, ...prev]);
    showToast(msg);
    setIsNewOrderModalOpen(false);
    setEditingOrder(null);

    // Record audit
    api.recordAudit({
      entity_type: 'order',
      entity_id: order.order_id,
      actor: 'staff',
      action: 'CREATE_ORDER',
      after_state: order,
    });
  };

  // ─── RENDER HELPERS ──────────────────────────────────
  const filteredOrders = orders.filter(o => statusFilter === 'ALL' || o.status === statusFilter);
  const getStatusCount = (status: OrderStatus | 'ALL') => {
    if (status === 'ALL') return orders.length;
    return orders.filter(o => o.status === status).length;
  };

  return (
    <div className="min-h-screen bg-[#07090d] text-slate-200 selection:bg-orange-500/30">
      {/* ─── NAVIGATION ─── */}
      <nav className="fixed top-0 w-full z-50 bg-[#07090d]/80 backdrop-blur-2xl border-b border-slate-800/50 px-6 py-4 flex justify-between items-center shadow-2xl">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <i className="fa-solid fa-fire-flame-curved text-white text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tighter text-white leading-none">QuickServe</h1>
              <div className="flex items-center gap-1.5 mt-1 cursor-help" onClick={() => setShowDiagnostics(true)}>
                <span className={`w-1.5 h-1.5 rounded-full ${connectionHealth.fetching ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-500">Bridge Inspector</span>
              </div>
            </div>
          </div>

          <div className="h-8 w-[1px] bg-slate-800 mx-2"></div>

          <div className="bg-slate-900/50 p-1 rounded-2xl border border-slate-800/50 flex gap-1">
            <button
              onClick={() => setActiveTab('KITCHEN')}
              className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'KITCHEN' ? 'bg-slate-800 text-white shadow-xl border border-slate-700' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              Kitchen
            </button>
            <button
              onClick={() => setActiveTab('ANALYTICS')}
              className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'ANALYTICS' ? 'bg-slate-800 text-white shadow-xl border border-slate-700' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              Analytics
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsStationScannerOpen(true)}
            className="px-5 py-3 rounded-2xl bg-slate-900/50 border border-slate-800/50 text-slate-400 hover:text-orange-400 hover:border-orange-500/30 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-qrcode text-xs"></i>
            <span className="text-[10px] font-black uppercase tracking-widest">Scan</span>
          </button>
          <button
            onClick={() => setIsHistoryModalOpen(true)}
            className="px-5 py-3 rounded-2xl bg-slate-900/50 border border-slate-800/50 text-slate-400 hover:text-white hover:bg-slate-800 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-clock-rotate-left text-xs"></i>
            <span className="text-[10px] font-black uppercase tracking-widest">History</span>
          </button>
          <button
            onClick={() => setIsNewOrderModalOpen(true)}
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-plus text-xs"></i>
            New Order
          </button>
        </div>
      </nav>

      {/* ─── MAIN CONTENT ─── */}
      <main className="pt-28 pb-12 px-8 max-w-[1600px] mx-auto min-h-screen">
        {activeTab === 'KITCHEN' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex bg-slate-900/40 p-1 rounded-2xl border border-slate-800/50 backdrop-blur-xl overflow-x-auto no-scrollbar max-w-full">
                {['ALL', OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY].map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f as any)}
                    className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all flex items-center gap-2 ${statusFilter === f ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    {String(f).replace(/_/g, ' ')}
                    <span className={`px-1.5 py-0.5 rounded-md text-[8px] ${statusFilter === f ? 'bg-white/20' : 'bg-slate-800 text-slate-500'}`}>
                      {getStatusCount(f as any)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-80 group">
                <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-orange-500 transition-colors"></i>
                <input
                  type="text"
                  placeholder="SEARCH ORDERS..."
                  className="w-full bg-slate-900/40 border border-slate-800/50 rounded-2xl pl-11 pr-4 py-3 text-[10px] font-black tracking-widest focus:outline-none focus:border-orange-500/50 focus:bg-slate-900/70 transition-all uppercase placeholder:text-slate-600"
                />
              </div>
            </div>

            {lastError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-2">
                <i className="fa-solid fa-triangle-exclamation text-rose-500"></i>
                <p className="text-[10px] font-black uppercase text-rose-500 tracking-widest">{lastError}</p>
              </div>
            )}

            <OrderGrid
              orders={filteredOrders}
              tableTracking={tableTracking}
              onAction={handleAction}
              disabled={isLoading}
              loading={isInitialLoad && filteredOrders.length === 0}
            />
          </div>
        ) : <MarketInsights activeOrders={orders} historyOrders={historyOrders} menu={menu} />}
      </main>

      {/* ═══ BRIDGE HEALTH INSPECTOR ═══ */}
      {showDiagnostics && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4">
          <div className="bg-slate-900 w-full max-w-3xl rounded-[3rem] border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div>
                <h3 className="font-black text-2xl uppercase tracking-tighter">Bridge Health Inspector</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">n8n ↔ Frontend Connection Debugger</p>
              </div>
              <button onClick={() => setShowDiagnostics(false)} className="text-slate-500 hover:text-white bg-slate-800 w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90">
                <i className="fa-solid fa-xmark text-2xl"></i>
              </button>
            </div>
            <div className="p-8 overflow-y-auto custom-scrollbar flex-1 font-mono text-xs">
              <div className="space-y-6">
                {/* Connection Status */}
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'GET Orders', ok: connectionHealth.fetching, url: N8N_ENDPOINTS.GET_ORDERS },
                    { label: 'Menu Sync', ok: connectionHealth.menu, url: N8N_ENDPOINTS.GET_MENU },
                    { label: 'POST Updates', ok: connectionHealth.updating, url: N8N_ENDPOINTS.UPDATE_ORDER },
                  ].map(ep => (
                    <div key={ep.label} className={`p-4 rounded-2xl border ${ep.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${ep.ok ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                        <span className="font-black text-[10px] uppercase tracking-widest">{ep.label}</span>
                      </div>
                      <p className="text-[8px] text-slate-500 break-all">{ep.url}</p>
                    </div>
                  ))}
                </div>

                {/* Latest Response */}
                <div className={`p-6 rounded-3xl border ${connectionHealth.fetching ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                  <p className="font-black text-white text-[10px] mb-3 uppercase tracking-widest">LATEST SERVER RESPONSE</p>
                  <pre className="text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto custom-scrollbar p-4 bg-black/40 rounded-2xl border border-slate-800/50">
                    {rawDebugData || 'No response captured. This usually indicates a Network Error or CORS Block.'}
                  </pre>
                </div>

                {/* Diagnostic Checklist */}
                <div className="p-6 rounded-3xl border bg-slate-950 border-slate-800">
                  <p className="font-black text-blue-400 text-[10px] mb-4 uppercase tracking-widest">DIAGNOSTIC CHECKLIST</p>
                  <ul className="space-y-4 text-slate-400">
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                      <span>Is your n8n workflow <strong>Active</strong>? (Production URLs only work if Active).</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                      <span>Check n8n environment variables for <strong>CORS</strong>:<br /><code className="text-white block mt-2 bg-slate-900 p-2 rounded">N8N_CORS_ALLOWED_ORIGINS=*</code></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                      <span>Did you use the <strong>Production</strong> URL, not the Test URL?</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center text-[10px] font-black shrink-0">4</span>
                      <span>Each endpoint needs its <strong>own Webhook node</strong> in n8n. Import the QuickServe Dashboard workflow JSON.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center text-[10px] font-black shrink-0">5</span>
                      <span>Google Sheets OAuth must be connected to the n8n nodes. Check credentials.</span>
                    </li>
                  </ul>
                </div>

                {/* Endpoint URLs for copy */}
                <div className="p-6 rounded-3xl border bg-slate-950 border-slate-800">
                  <p className="font-black text-orange-400 text-[10px] mb-4 uppercase tracking-widest">CONFIGURED ENDPOINTS</p>
                  <div className="space-y-2">
                    {Object.entries(N8N_ENDPOINTS).map(([key, url]) => (
                      <div key={key} className="flex items-center gap-3 bg-slate-900 p-3 rounded-xl border border-slate-800">
                        <span className="text-[9px] font-black text-slate-500 uppercase w-28 shrink-0">{key}</span>
                        <code className="text-[9px] text-slate-300 flex-1 break-all">{url}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALS ═══ */}
      {(isNewOrderModalOpen || editingOrder) && (
        <NewOrderModal
          initialOrder={editingOrder || undefined}
          menuItems={menu}
          occupiedTableIds={new Set(orders.map(o => o.table_id))}
          onClose={() => { setIsNewOrderModalOpen(false); setEditingOrder(null); }}
          onSuccess={handleCreateSuccess}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {isHistoryModalOpen && <HistoryModal history={historyOrders} menuItems={menu} onClose={() => setIsHistoryModalOpen(false)} onClear={() => { setHistoryOrders([]); localStorage.removeItem('qs_history'); }} />}
      {isStationScannerOpen && <QRScanner onScan={handleGlobalScan} onClose={() => setIsStationScannerOpen(false)} />}
      {viewingBillOrder && <BillModal order={viewingBillOrder} menuItems={menu} onClose={() => setViewingBillOrder(null)} />}
      {viewingQR && <QRModal type={viewingQR.type} tableId={viewingQR.tableId} orderId={viewingQR.orderId} onClose={() => setViewingQR(null)} />}
      {toastMessage && <Toast message={toastMessage.text} type={toastMessage.type} />}
    </div>
  );
};

export default App;