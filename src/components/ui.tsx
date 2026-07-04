// Small shared UI pieces — pulse strip, panel footnotes, toast stack.
import React from "react";
import { PulseStat } from "../data";
import { useApp } from "../store";
import { CheckI } from "./icons";

export function Pulse({ data }: { data: PulseStat[] }) {
  const { toast } = useApp();
  return (
    <div className="pulse">
      {data.map((s, i) => (
        <div className="stat" key={i} onClick={() => toast(s.k, "Drills through to the underlying records")}>
          <div className="k"><span className={`tick ${s.tick}`} />{s.k}</div>
          <div className="v">{s.v}</div>
          <div className={`delta ${s.dc}`}>{s.dc === "up" ? "▲" : s.dc === "down" ? "▼" : "•"} {s.d}</div>
        </div>
      ))}
    </div>
  );
}

// Muted footnote row at the bottom of a panel.
export function Note({ children, noBorder }: { children: React.ReactNode; noBorder?: boolean }) {
  return (
    <div style={{ padding: "13px 18px", fontSize: 12, color: "var(--ink-soft)", borderTop: noBorder ? undefined : "1px solid var(--hairline)" }}>
      {children}
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <div className="ti"><CheckI /></div>
          <div>
            <div>{t.title}</div>
            {t.sub && <small>{t.sub}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
