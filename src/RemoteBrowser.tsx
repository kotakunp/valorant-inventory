// Remote interactive browser for hosted AUTO LOGIN.
// Streams server-side Chromium frames; forwards mouse/keyboard; polls until done.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import type { Region, ShowcasePayload } from "./types";

type Phase = "idle" | "starting" | "login" | "harvesting" | "done" | "error" | "expired";

interface Status {
  active: boolean;
  phase: Phase;
  width: number;
  height: number;
  error?: string;
}

interface Props {
  region: Region;
  onDone: (payload: ShowcasePayload) => void;
}

export function RemoteBrowserPanel({ region, onDone }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const startedRef = useRef(false);
  const startFailedRef = useRef(false);
  const pollEnabledRef = useRef(false);
  const regionRef = useRef(region);
  regionRef.current = region;

  const sendInput = useCallback(async (body: unknown) => {
    try {
      await fetch("/api/browser/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* session closed */
    }
  }, []);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/browser/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region: regionRef.current }),
      });
      const json = (await res.json().catch(() => ({}))) as Status & { error?: string };
      if (!res.ok || json.error) {
        const msg = json.error ?? `Could not start remote browser (${res.status})`;
        setErr(msg);
        setStatus({ active: false, phase: "error", width: 0, height: 0, error: msg });
        startedRef.current = false;
        startFailedRef.current = true;
        return;
      }
      startFailedRef.current = false;
      setStatus(json);
      pollEnabledRef.current = true;
      // Kick the frame/status loop only after start succeeds (mount-time tick exits early).
      setPollEpoch((n) => n + 1);
    } catch {
      const msg = "Network error starting remote browser.";
      setErr(msg);
      setStatus({ active: false, phase: "error", width: 0, height: 0, error: msg });
      startedRef.current = false;
      startFailedRef.current = true;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  // Frame + status poll loop — runs when pollEpoch changes (after a successful start)
  useEffect(() => {
    if (pollEpoch === 0 || startFailedRef.current || !pollEnabledRef.current) return;
    let dead = false;
    let frameSeq = 0;
    const tick = async () => {
      if (dead || startFailedRef.current || !pollEnabledRef.current) return;
      try {
        const stRes = await fetch("/api/browser/status");
        const st = (await stRes.json()) as Status;
        if (dead) return;
        setStatus(st);

        if (st.phase === "done") {
          const resultRes = await fetch("/api/browser/result");
          if (resultRes.ok) {
            const payload = (await resultRes.json()) as ShowcasePayload;
            if (!dead) onDone(payload);
          }
          return;
        }
        if (st.phase === "error" || st.phase === "expired") {
          // Prefer server-provided error; do not clobber a start failure we already showed.
          setErr((prev) => st.error || prev || "Remote browser session ended.");
          pollEnabledRef.current = false;
          return;
        }

        // Cache-bust JPEG frame
        frameSeq += 1;
        const f = await fetch(`/api/browser/frame?_=${frameSeq}`);
        if (f.ok) {
          const blob = await f.blob();
          if (!dead) {
            const url = URL.createObjectURL(blob);
            setFrameSrc((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return url;
            });
          }
        }
      } catch {
        /* transient */
      }
      if (!dead) setTimeout(tick, 350);
    };
    void tick();
    return () => {
      dead = true;
    };
  }, [onDone, pollEpoch]);

  const toPageXY = (e: MouseEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || !status) return null;
    const rect = img.getBoundingClientRect();
    const sx = status.width / rect.width;
    const sy = status.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * sx),
      y: Math.round((e.clientY - rect.top) * sy),
    };
  };

  const onClick = (e: MouseEvent<HTMLImageElement>) => {
    const p = toPageXY(e);
    if (p) void sendInput({ type: "click", ...p });
  };

  const onMove = (e: MouseEvent<HTMLImageElement>) => {
    const p = toPageXY(e);
    if (p) void sendInput({ type: "mousemove", ...p });
  };

  const onWheel = (e: WheelEvent<HTMLImageElement>) => {
    const p = toPageXY(e);
    if (p) {
      e.preventDefault();
      void sendInput({ type: "wheel", ...p, deltaX: 0, deltaY: e.deltaY });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Forward keys to the remote page when the panel has focus.
    if (e.key === "Tab" || e.key === "Enter" || e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      void sendInput({ type: "press", key: e.key });
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void sendInput({ type: "type", text: e.key });
    }
  };

  const stop = async () => {
    await fetch("/api/browser/stop", { method: "POST" }).catch(() => {});
    setRemoteClosed();
  };

  // parent clears remoteOpen via onDone; stop without done → local hide
  const setRemoteClosed = () => {
    startedRef.current = false;
    startFailedRef.current = false;
    pollEnabledRef.current = false;
    setPollEpoch(0);
    setStatus({ active: false, phase: "expired", width: 0, height: 0 });
    setFrameSrc(null);
    setErr("Remote browser closed.");
  };

  if (err && (startFailedRef.current || status?.phase !== "login") && status?.phase !== "starting" && status?.phase !== "harvesting") {
    return (
      <div className="remote-browser">
        <p className="note" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{err}</p>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            setErr(null);
            startedRef.current = false;
            startFailedRef.current = false;
            pollEnabledRef.current = false;
            setPollEpoch(0);
            void start();
          }}
        >
          Retry
        </button>
        <p className="note">
          If Chromium is missing on the server, redeploy after nixpacks installs it, or paste the
          ssid cookie instead.
        </p>
      </div>
    );
  }

  return (
    <div className="remote-browser" tabIndex={0} onKeyDown={onKeyDown}>
      <p className="note" style={{ marginTop: 0 }}>
        A Chromium window is running on the server. Log in on Riot&apos;s real page inside the frame
        (captcha + 2FA work normally). When cookies appear, the showcase loads automatically.
        {busy && " Starting…"}
        {status?.phase === "harvesting" && " Login detected — fetching collection…"}
      </p>
      <div className="remote-frame-wrap">
        {frameSrc ? (
          <img
            ref={imgRef}
            src={frameSrc}
            alt="Remote Riot login"
            className="remote-frame"
            style={{ maxWidth: "100%", cursor: "crosshair" }}
            draggable={false}
            onClick={onClick}
            onMouseMove={onMove}
            onWheel={onWheel}
          />
        ) : (
          <div className="remote-placeholder">Loading remote browser…</div>
        )}
      </div>
      <div className="remote-actions">
        <button className="btn ghost" type="button" onClick={() => void stop()} disabled={busy}>
          Close
        </button>
        <span className="note" style={{ margin: 0 }}>
          Status: {status?.phase ?? "…"}
        </span>
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
