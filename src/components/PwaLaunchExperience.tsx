import { useEffect, useState } from "react";
import { clearPwaBadge } from "@/lib/pwa-badging";

export function PwaLaunchExperience() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [statusText, setStatusText] = useState("INITIALIZING DECAY RADAR...");
  const [progress, setProgress] = useState(15);

  useEffect(() => {
    // Check if cold boot / app launch
    const hasSeen = sessionStorage.getItem("seo4web_splash_seen");
    if (hasSeen) {
      return;
    }

    setVisible(true);

    // Clear home screen badge on app launch
    clearPwaBadge();

    // Haptic pulse on cold start (if device supports)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([15, 30, 20]);
      } catch {
        // ignore
      }
    }

    // Sequencer
    const t1 = setTimeout(() => {
      setStatusText("SYNCING SERP TELEMETRY & AUDIT CACHE...");
      setProgress(60);
    }, 320);

    const t2 = setTimeout(() => {
      setStatusText("COMMAND CENTER READY");
      setProgress(100);
    }, 680);

    const t3 = setTimeout(() => {
      setFading(true);
      sessionStorage.setItem("seo4web_splash_seen", "true");
    }, 950);

    const t4 = setTimeout(() => {
      setVisible(false);
    }, 1250);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => {
        setFading(true);
        setTimeout(() => setVisible(false), 200);
        sessionStorage.setItem("seo4web_splash_seen", "true");
      }}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[#171717] px-6 select-none transition-all duration-300 ${
        fading ? "opacity-0 scale-105 pointer-events-none" : "opacity-100 scale-100"
      }`}
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Ambient background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08)_0%,transparent_70%)] pointer-events-none" />

      {/* Main emblem container with animated radar */}
      <div className="relative flex flex-col items-center text-center">
        <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
          {/* Animated radar halo */}
          <div className="absolute inset-0 animate-ping rounded-3xl bg-emerald-500/10 opacity-75 duration-1000" />
          <img
            src="/icons/seo4web-animated.svg"
            alt="SEO4WEB"
            className="relative h-24 w-24 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.8)] border border-emerald-500/20"
          />
        </div>

        {/* Brand Typography */}
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          SEO<span className="text-emerald-400">4</span>WEB
        </h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-zinc-400">
          AI SEO Command Center
        </p>

        {/* High-tech Progress Line */}
        <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-zinc-800 border border-zinc-700/50">
          <div
            className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-teal-300 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Telemetry Ticker Text */}
        <p className="mt-3 font-mono text-[10px] text-zinc-400 tracking-wider transition-all">
          {statusText}
        </p>
      </div>

      {/* Subtle skip indicator */}
      <div className="absolute bottom-6 text-[10px] text-zinc-400 opacity-60">
        Ťuknite pre preskočenie
      </div>
    </div>
  );
}
