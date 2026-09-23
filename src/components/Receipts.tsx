import { useState } from "react";
import { useApp } from "../store";
import { ModalShell } from "./modals";
import { Note } from "./ui";
import { kes } from "../data";

// A record's attached receipts as numbered chips (click to open, × to remove) plus a
// "+ Receipt" picker that accepts several files at once. Used on claim/advance lines and
// petty-cash requests, on both the Staff Portal and the Finance/HR side.
export function ReceiptList({ paths, onAdd, onRemove, busy, addLabel = "Add receipts", readOnly }: {
  paths: string[];
  onAdd?: (files: File[]) => void;
  onRemove?: (path: string) => void;
  busy?: boolean;
  addLabel?: string;
  readOnly?: boolean;
}) {
  const { uploadedFileUrl } = useApp();
  const open = (p: string) => window.open(uploadedFileUrl(p), "_blank", "noopener");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {paths.map((p, i) => (
        <span key={p} className="pill" style={{ textTransform: "none", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); open(p); }} style={{ color: "var(--flame)", textDecoration: "none" }}
            title={p.split("/").pop()?.replace(/^\d+-/, "")}>
            {paths.length > 1 ? `Receipt ${i + 1}` : "Receipt"}
          </a>
          {!readOnly && onRemove && (
            <button type="button" onClick={() => onRemove(p)} title="Remove this file"
              style={{ border: 0, background: "none", color: "var(--red)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
          )}
        </span>
      ))}
      {!readOnly && onAdd && (
        <label className="btn" style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
          {busy ? "Uploading…" : `+ ${addLabel}`}
          <input type="file" multiple accept=".pdf,image/*" style={{ display: "none" }} disabled={busy}
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) onAdd(fs); }} />
        </label>
      )}
      {readOnly && paths.length === 0 && <span style={{ fontSize: 11, color: "var(--mute, #888)" }}>none</span>}
    </div>
  );
}

// Manage receipts on an already-filed claim or advance, line by line. Looks the record up
// live from the store so the list refreshes as files are added/removed. The claimant/holder
// and HR / Super Admin can both use it (the server enforces who).
export function LineReceiptsModal({ kind, id, onClose }: { kind: "claim" | "advance"; id: string | null; onClose: () => void }) {
  const { claims, advances, attachClaimReceipts, removeClaimReceipt, attachAdvanceReceipts, removeAdvanceReceipt } = useApp();
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const rec = !id ? null : kind === "claim" ? claims.find((c) => c.id === id) : advances.find((a) => a.id === id);
  const lines = (rec ? rec.lines : []).filter((l) => !l.isPerDiem && l.id);
  const add = kind === "claim" ? attachClaimReceipts : attachAdvanceReceipts;
  const remove = kind === "claim" ? removeClaimReceipt : removeAdvanceReceipt;
  async function onAdd(lineId: string, files: File[]) {
    setBusyLine(lineId);
    await add(lineId, files);
    setBusyLine(null);
  }
  return (
    <ModalShell open={!!rec} onClose={onClose} width={600}>
      {rec && (
        <>
          <div className="mh">
            <h3>Receipts · {rec.id}</h3>
            <p>{rec.purpose} — attach as many receipts as each line needs (PDF or photo). You can add more at any time.</p>
          </div>
          <div className="mb">
            {lines.length ? (
              <table className="tbl">
                <thead><tr><th>Line</th><th>Amount</th><th>Receipts</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>{catLabel(l.category)}{l.detail ? <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>{l.detail}</small> : null}</td>
                      <td className="mono">{kes(l.amount)}</td>
                      <td>
                        <ReceiptList paths={l.receiptPaths} busy={busyLine === l.id}
                          onAdd={(fs) => onAdd(l.id!, fs)} onRemove={(p) => remove(l.id!, p)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>{kind === "advance" ? "No spent lines yet — receipts go on the lines entered when the advance is reconciled." : "This claim has no expense lines that take receipts (per-diem lines don't need them)."}</Note>
            )}
          </div>
          <div className="mf"><button className="btn primary" onClick={onClose}>Done</button></div>
        </>
      )}
    </ModalShell>
  );
}

const CATS: Record<string, string> = { transport: "Transport", accommodation: "Accommodation", meals: "Meals", airtime: "Airtime", supplies: "Supplies", other: "Other", per_diem: "Per diem" };
const catLabel = (c: string) => CATS[c] ?? c;
