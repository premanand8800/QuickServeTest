"use client";

import { useEffect, useRef, useState } from "react";

type CameraPermissionState = PermissionState | "unknown" | "unsupported";

type LiveQrScannerProps = {
  onDetected: (value: string) => void;
};

export default function LiveQrScanner({ onDetected }: LiveQrScannerProps) {
  const [permission, setPermission] = useState<CameraPermissionState>("unknown");
  const [running, setRunning] = useState(false);
  const [scannerHint, setScannerHint] = useState("");
  const [streamError, setStreamError] = useState("");
  const [supportsDetection, setSupportsDetection] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDetectionRef = useRef<{ value: string; at: number }>({
    value: "",
    at: 0,
  });
  const permissionStatusRef = useRef<PermissionStatus | null>(null);

  const stopScanner = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setRunning(false);
  };

  const syncPermission = async () => {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      return;
    }
    if (!navigator.permissions?.query) {
      setPermission("unknown");
      return;
    }

    try {
      const status = await navigator.permissions.query({
        name: "camera" as PermissionName,
      });
      permissionStatusRef.current = status;
      setPermission(status.state);
      status.onchange = () => setPermission(status.state);
    } catch {
      setPermission("unknown");
    }
  };

  const requestAndStart = async () => {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      setStreamError("Camera is not supported on this browser/device.");
      return;
    }

    setStreamError("");
    setScannerHint("");
    await syncPermission();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setPermission("granted");
      setRunning(true);
    } catch (error: any) {
      const denied =
        error?.name === "NotAllowedError" || error?.name === "SecurityError";
      if (denied) setPermission("denied");
      setRunning(false);
      setStreamError(
        denied
          ? "Camera permission was denied. Allow camera access in your browser settings and retry."
          : "Unable to start scanner camera. Please retry.",
      );
    }
  };

  useEffect(() => {
    void syncPermission();
    return () => {
      permissionStatusRef.current = null;
      stopScanner();
    };
  }, []);

  useEffect(() => {
    if (!running || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => {
      setStreamError("Unable to play camera stream.");
    });
  }, [running]);

  useEffect(() => {
    if (!running) return;
    if (typeof window === "undefined") return;

    const DetectorCtor = (window as any).BarcodeDetector;
    if (!DetectorCtor) {
      setSupportsDetection(false);
      setScannerHint(
        "Live QR detection is not supported in this browser. Use manual input or a browser with BarcodeDetector support.",
      );
      return;
    }
    setSupportsDetection(true);
    setScannerHint("Point the camera at a table/order QR code.");

    let detector: any;
    try {
      detector = new DetectorCtor({
        formats: [
          "qr_code",
          "code_128",
          "ean_13",
          "ean_8",
          "upc_a",
          "upc_e",
        ],
      });
    } catch {
      detector = new DetectorCtor();
    }

    let cancelled = false;
    scanTimerRef.current = setInterval(async () => {
      if (cancelled || !videoRef.current) return;
      if (videoRef.current.readyState < 2) return;
      try {
        const result = await detector.detect(videoRef.current);
        const raw = String(result?.[0]?.rawValue || "").trim();
        if (!raw) return;
        const now = Date.now();
        const prev = lastDetectionRef.current;
        if (prev.value === raw && now - prev.at < 1800) return;
        lastDetectionRef.current = { value: raw, at: now };
        onDetected(raw);
      } catch {
        // ignore intermittent frame decode errors
      }
    }, 420);

    return () => {
      cancelled = true;
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    };
  }, [running, onDetected]);

  const permissionLabel =
    permission === "granted"
      ? "Granted"
      : permission === "denied"
        ? "Denied"
        : permission === "prompt"
          ? "Prompt"
          : permission === "unsupported"
            ? "Unsupported"
            : "Unknown";

  const permissionStyle =
    permission === "granted"
      ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
      : permission === "denied"
        ? "text-red-300 border-red-500/40 bg-red-500/10"
        : "text-slate-300 border-slate-600 bg-slate-800/60";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-[10px] uppercase tracking-[0.14em] font-black px-2 py-1 rounded-md border ${permissionStyle}`}
        >
          Camera Permission: {permissionLabel}
        </span>
        <div className="flex gap-2">
          {!running ? (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => void requestAndStart()}
              disabled={permission === "unsupported"}
            >
              Request + Start Scanner
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost bg-slate-800 border-slate-700 text-xs"
              onClick={stopScanner}
            >
              Stop Scanner
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border border-slate-700 bg-black">
        {running ? (
          <video
            ref={videoRef}
            className="w-full h-[280px] object-cover"
            playsInline
            muted
          />
        ) : (
          <div className="h-[220px] grid place-items-center text-xs text-slate-400 px-4 text-center">
            Start scanner to request camera access and detect QR/barcode in real
            time.
          </div>
        )}
      </div>

      {streamError ? (
        <div className="text-xs rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger">
          {streamError}
        </div>
      ) : null}

      {supportsDetection && scannerHint ? (
        <p className="text-xs text-slate-400">{scannerHint}</p>
      ) : null}
    </div>
  );
}
