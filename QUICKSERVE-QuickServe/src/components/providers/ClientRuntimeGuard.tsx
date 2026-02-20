"use client";

import { useEffect, useState } from "react";

const RELOAD_KEY = "qs_runtime_reload_once";

function shouldAutoReload(message: string): boolean {
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Unexpected token '<'|Hydration/i.test(
    message,
  );
}

export default function ClientRuntimeGuard() {
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = String(event?.message || "");
      if (!msg) return;
      if (shouldAutoReload(msg)) {
        const reloaded = sessionStorage.getItem(RELOAD_KEY);
        if (!reloaded) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
          return;
        }
      }
      setFatalError(msg);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const msg = String(event?.reason?.message || event?.reason || "");
      if (!msg) return;
      if (shouldAutoReload(msg)) {
        const reloaded = sessionStorage.getItem(RELOAD_KEY);
        if (!reloaded) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
          return;
        }
      }
      setFatalError(msg);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!fatalError) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/95 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-xl w-full border border-slate-700 bg-slate-900 rounded-2xl p-5 space-y-3">
        <h2 className="text-lg font-black tracking-tight">Application Recovery</h2>
        <p className="text-sm text-slate-300">
          A client runtime error occurred. Use hard refresh, then retry.
        </p>
        <p className="text-xs text-slate-400 break-all">{fatalError}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              sessionStorage.removeItem(RELOAD_KEY);
              window.location.reload();
            }}
          >
            Reload App
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setFatalError(null)}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
