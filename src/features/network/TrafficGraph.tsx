// Live traffic graph for a connected VPN / SSH tunnel (download green, upload orange).
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { TrafficSample } from "../../lib/types";
import { fmtBytes, fmtRate } from "./store";

const RX = "var(--color-ok)";
const TX = "var(--color-accent)";
const W = 600;
const PAD_TOP = 22;
const PAD_BOTTOM = 6;

/** Smooth path through points (Catmull–Rom → cubic Bézier), clamped to the plot. */
function smooth(pts: [number, number][], floor: number): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1y = Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6);
    const c2y = Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${c1y} ${p2[0] - (p3[0] - p1[0]) / 6},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function useTick(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function TrafficGraph({ samples, connected, height = 150, compact }: {
  samples: TrafficSample[];
  connected: boolean;
  height?: number;
  /** Smaller variant without footer details (sidebar / cards). */
  compact?: boolean;
}) {
  const [windowSec, setWindowSec] = useState(60);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradId = `rx-fill-${useId().replace(/:/g, "")}`;
  const now = useTick(1000);
  const H = height;
  const floor = H - PAD_BOTTOM;
  const start = now - windowSec * 1000;

  const visible = useMemo(() => samples.filter((s) => s.at >= start - 2000), [samples, start]);
  const peak = useMemo(() => Math.max(1024, ...visible.map((s) => Math.max(s.rxRate, s.txRate))) * 1.15, [visible]);
  const x = (at: number) => ((at - start) / (windowSec * 1000)) * W;
  const y = (v: number) => floor - (v / peak) * (floor - PAD_TOP);
  const rxPts = visible.map((s) => [x(s.at), y(s.rxRate)] as [number, number]);
  const txPts = visible.map((s) => [x(s.at), y(s.txRate)] as [number, number]);
  const rxPath = smooth(rxPts, floor);
  const txPath = smooth(txPts, floor);
  const area = rxPts.length > 1 ? `${rxPath} L${rxPts[rxPts.length - 1][0]},${floor} L${rxPts[0][0]},${floor} Z` : "";

  const last = samples[samples.length - 1];
  const lastActive = useMemo(() => {
    for (let i = samples.length - 1; i >= 0; i--) if (samples[i].rxRate > 0 || samples[i].txRate > 0) return samples[i].at;
    return null;
  }, [samples]);
  const ago = lastActive ? Math.max(0, Math.round((now - lastActive) / 1000)) : null;
  const hovered = hover !== null ? visible[hover] : null;

  const onMove = (e: React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !visible.length) return;
    const at = start + ((e.clientX - r.left) / r.width) * windowSec * 1000;
    let best = 0;
    visible.forEach((s, i) => { if (Math.abs(s.at - at) < Math.abs(visible[best].at - at)) best = i; });
    setHover(best);
  };

  return (
    <div className={clsx("rounded-lg border bg-app/60", connected ? "border-ok/40" : "border-line")}>
      <div className="relative px-3 pt-2">
        <div className="pointer-events-none absolute top-1.5 right-3 flex items-center gap-2 text-[11px] text-faint tabular-nums">
          {fmtRate(peak / 1.15)}
        </div>
        {!compact && (
          <div className="absolute top-1 left-3 flex gap-0.5 text-[10px]">
            {[60, 300].map((w) => (
              <button
                key={w}
                onClick={() => setWindowSec(w)}
                className={clsx("rounded px-1.5 py-px", windowSec === w ? "bg-hover text-fg" : "text-faint hover:text-muted")}
              >
                {w === 60 ? "1m" : "5m"}
              </button>
            ))}
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: H }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={RX} stopOpacity="0.25" />
              <stop offset="1" stopColor={RX} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={PAD_TOP} y2={PAD_TOP} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {[1, 2].map((i) => {
            const gy = PAD_TOP + ((floor - PAD_TOP) * i) / 3;
            return <line key={i} x1="0" x2={W} y1={gy} y2={gy} stroke="var(--color-line)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
          })}
          <line x1="0" x2={W} y1={floor + 0.5} y2={floor + 0.5} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {area && <path d={area} fill={`url(#${gradId})`} />}
          {txPath && <path d={txPath} fill="none" stroke={TX} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.9" />}
          {rxPath && <path d={rxPath} fill="none" stroke={RX} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {hovered && (
            <line x1={x(hovered.at)} x2={x(hovered.at)} y1={PAD_TOP} y2={floor} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {!connected && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-faint">Not connected</div>
        )}
        {connected && !visible.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-faint">Waiting for traffic data…</div>
        )}
      </div>
      <div className={clsx("flex items-center gap-4 px-3 tabular-nums", compact ? "py-1.5 text-[11px]" : "py-2 text-[13px]")}>
        <span className="flex items-center gap-1.5" style={{ color: RX }} title="Download">
          <span className="flex size-4 items-center justify-center rounded-full border" style={{ borderColor: RX }}><ArrowDown className="size-2.5" /></span>
          {fmtRate((hovered ?? last)?.rxRate ?? 0)}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: TX }} title="Upload">
          <span className="flex size-4 items-center justify-center rounded-full border" style={{ borderColor: TX }}><ArrowUp className="size-2.5" /></span>
          {fmtRate((hovered ?? last)?.txRate ?? 0)}
        </span>
        {hovered ? (
          <span className="text-muted">{new Date(hovered.at).toLocaleTimeString()}</span>
        ) : (
          connected && ago !== null && <span className="text-fg/80" title="Last time traffic moved">~{ago} sec ago</span>
        )}
        {!compact && last && (
          <span className="ml-auto text-[11px] text-faint" title="Total since connected">
            ↓ {fmtBytes(last.rxTotal)} · ↑ {fmtBytes(last.txTotal)}
          </span>
        )}
      </div>
    </div>
  );
}
