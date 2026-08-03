// SVG chart primitives — donut, legend, vertical bars, animated bar rows.
// Ported 1:1 from the prototype's donut()/chartLegend()/vbars()/bars().
import { useEffect, useRef } from "react";

export interface Seg { l: string; v: number; c: string; d: string }

export function Donut({ segs, size = 150, thick = 26, big, small }: { segs: Seg[]; size?: number; thick?: number; big?: string; small?: string }) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  const r = (size - thick) / 2, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  let off = 0;
  const arcs = segs.map((s, i) => {
    const len = (circ * s.v) / total;
    const el = (
      <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.c} strokeWidth={thick}
        strokeDasharray={`${len.toFixed(2)} ${(circ - len).toFixed(2)}`}
        strokeDashoffset={(-off).toFixed(2)} transform={`rotate(-90 ${cx} ${cy})`} />
    );
    off += len;
    return el;
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0 }}>
      {arcs}
      {big && (
        <text x={cx} y={cy - 1} textAnchor="middle" fontFamily="Space Grotesk,sans-serif" fontSize="22" fontWeight="600" fill="#1A1512">{big}</text>
      )}
      {big && small && (
        <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fill="#74695D">{small}</text>
      )}
    </svg>
  );
}

export function ChartLegend({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, padding: "4px 0" }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: s.c, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{s.l}</span>
          <span className="mono" style={{ color: "var(--ink-soft)", fontSize: 11.5 }}>{s.d}</span>
        </div>
      ))}
    </>
  );
}

export function VBars({ items, color }: { items: { l: string; v: number }[]; color: string }) {
  const max = Math.max(...items.map((i) => i.v)) || 1;
  const W = 320, H = 130, gap = W / items.length, bw = gap * 0.46;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {items.map((it, i) => {
        const bh = (it.v / max) * (H - 30), x = i * gap + (gap - bw) / 2, y = H - bh - 20;
        return (
          <g key={i}>
            <rect x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)} rx="3" fill={color} />
            <text x={(x + bw / 2).toFixed(1)} y={(y - 5).toFixed(1)} textAnchor="middle" fontSize="10" fontFamily="IBM Plex Mono,monospace" fill="#74695D">{it.v}</text>
            <text x={(x + bw / 2).toFixed(1)} y={H - 5} textAnchor="middle" fontSize="10" fill="#74695D">{it.l}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Grouped vertical bar chart — two bars per group (e.g. budget vs spent per project),
// value labels above each bar and the group label below. Scales to the tallest bar.
export interface BarGroup { l: string; a: number; b: number }
export function GroupedBars({ groups, aColor = "var(--flame)", bColor = "var(--ember)", fmt = (n: number) => String(n) }:
  { groups: BarGroup[]; aColor?: string; bColor?: string; fmt?: (n: number) => string }) {
  const max = Math.max(...groups.flatMap((g) => [g.a, g.b]), 1);
  const groupW = 120, bw = 32, gap = 10, top = 24, plotH = 150, bottom = 28;
  const H = top + plotH + bottom, W = Math.max(groups.length * groupW, groupW);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1={top + plotH} x2={W} y2={top + plotH} stroke="var(--line)" strokeWidth="1" />
      {groups.map((g, i) => {
        const cx = i * groupW + groupW / 2;
        const ax = cx - bw - gap / 2, bx = cx + gap / 2;
        const ah = (g.a / max) * plotH, bh = (g.b / max) * plotH;
        return (
          <g key={i}>
            <rect x={ax.toFixed(1)} y={(top + plotH - ah).toFixed(1)} width={bw} height={Math.max(ah, 1).toFixed(1)} rx="3" fill={aColor} />
            <rect x={bx.toFixed(1)} y={(top + plotH - bh).toFixed(1)} width={bw} height={Math.max(bh, 1).toFixed(1)} rx="3" fill={bColor} />
            <text x={(ax + bw / 2).toFixed(1)} y={(top + plotH - ah - 6).toFixed(1)} textAnchor="middle" fontSize="9.5" fontFamily="IBM Plex Mono,monospace" fill="#74695D">{fmt(g.a)}</text>
            <text x={(bx + bw / 2).toFixed(1)} y={(top + plotH - bh - 6).toFixed(1)} textAnchor="middle" fontSize="9.5" fontFamily="IBM Plex Mono,monospace" fill="#74695D">{fmt(g.b)}</text>
            <text x={cx.toFixed(1)} y={top + plotH + 18} textAnchor="middle" fontSize="11" fill="#1A1512">{g.l}</text>
          </g>
        );
      })}
    </svg>
  );
}

export interface BarRow { l: string; n: string; w: number; c: string }

// Animated horizontal bar rows — fill widths transition in on mount.
export function Bars({ rows }: { rows: BarRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.querySelectorAll<HTMLElement>(".fill").forEach((f, i) => {
        f.style.width = rows[i].w + "%";
      });
    }, 60);
    return () => clearTimeout(t);
  }, [rows]);
  return (
    <div ref={ref}>
      {rows.map((b, i) => (
        <div className="barrow" key={i}>
          <div className="lab">{b.l}</div>
          <div className="track"><div className="fill" style={{ width: 0, background: b.c }} /></div>
          <div className="num">{b.n}</div>
        </div>
      ))}
    </div>
  );
}

// Static bar rows (widths fixed in markup, as in the prototype's hand-written panels).
export function StaticBars({ rows }: { rows: BarRow[] }) {
  return (
    <>
      {rows.map((b, i) => (
        <div className="barrow" key={i}>
          <div className="lab">{b.l}</div>
          <div className="track"><div className="fill" style={{ width: `${b.w}%`, background: b.c }} /></div>
          <div className="num">{b.n}</div>
        </div>
      ))}
    </>
  );
}
