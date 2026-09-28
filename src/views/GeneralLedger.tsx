// General Ledger (Jikoni_General_Ledger_Guide_and_Spec — mig 0089/0090).
// The one record every module posts into and every report reads from:
//   Accounts · Journals · Manual journals · Reports · Periods · Setup   (Finance → General Ledger)
//   Bank & cash reconciliation                                          (Finance → Bank & Cash)
// Reads go straight to the ledger tables / report RPCs; every write is an RPC that
// enforces the controls server-side (balanced, coded, approved, period-locked).
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp, niceError } from "../store";
import { supabase } from "../lib/supabase";
import { Note } from "../components/ui";
import { ModalShell } from "../components/modals";
import { ReceiptList } from "../components/Receipts";
import { PlusI } from "../components/icons";
import { keToday } from "../lib/invoiceDoc";

/* ---------------- helpers ---------------- */
type Acct = { code: string; name: string; kind: string; active: boolean; reconcilable: boolean; manual_allowed: boolean; description: string | null };
const KINDS = ["asset", "liability", "equity", "income", "expense"] as const;
const KIND_L: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };
const money = (n: number | string | null | undefined) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => (n < 0 ? `(${money(-n)})` : money(n));
const thisPeriod = () => keToday().slice(0, 7);
const periodLabel = (p: string) => new Date(p + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
function lastPeriods(n: number) {
  const out: string[] = []; const [y, m] = thisPeriod().split("-").map(Number);
  for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}
const PERIOD_STATES: Record<string, { l: string; cls: string }> = {
  open: { l: "Open", cls: "today" }, reconciled: { l: "Reconciled", cls: "week" }, tb_agreed: { l: "TB agreed", cls: "week" },
  closed: { l: "Closed", cls: "done" }, reported: { l: "Reported", cls: "done" },
};
const MJ_STATES: Record<string, { l: string; cls: string }> = {
  draft: { l: "Draft", cls: "week" }, submitted: { l: "Awaiting approval", cls: "today" }, posted: { l: "Posted", cls: "done" }, rejected: { l: "Rejected", cls: "over" },
};
const AUTHORITIES: [string, string][] = [["line_manager", "Line Manager"], ["chief_of_staff", "Chief of Staff"], ["md", "MD"], ["board", "Board member"]];
const authLabel = (a: string) => AUTHORITIES.find(([k]) => k === a)?.[1] ?? a;
function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.rpc(fn, args);
  return { data: (data as T) ?? null, error: error ? niceError(error.message) : null };
}
function useAccounts() {
  const [accts, setAccts] = useState<Acct[]>([]);
  const load = () => supabase.from("chart_of_accounts").select("code, name, kind, active, reconcilable, manual_allowed, description").order("code")
    .then(({ data }) => setAccts((data ?? []) as Acct[]));
  useEffect(() => { load(); }, []);
  return { accts, reloadAccts: load };
}
const Empty = ({ children }: { children: ReactNode }) => <div className="pad" style={{ color: "var(--ink-soft)", fontSize: 13 }}>{children}</div>;
const th = { textAlign: "right" } as const;
const sub = { textTransform: "none", fontWeight: 400, letterSpacing: 0 } as const;
function PeriodSelect({ value, onChange, n = 18 }: { value: string; onChange: (p: string) => void; n?: number }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {lastPeriods(n).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
    </select>
  );
}

/* ================= General Ledger (Finance → General Ledger) ================= */
const GL_TABS: [string, string][] = [["accounts", "Chart of accounts"], ["journals", "Journals"], ["manual", "Manual journals"], ["reports", "Reports"], ["periods", "Periods"], ["setup", "Setup"]];
export function glOpenSub(t: string) {
  try { localStorage.setItem("gl.sub", t); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("gl-sub", { detail: t }));
}

export function GeneralLedger() {
  const [t, setT] = useState<string>(() => { try { return localStorage.getItem("gl.sub") || "accounts"; } catch { return "accounts"; } });
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent).detail);
    window.addEventListener("gl-sub", on); return () => window.removeEventListener("gl-sub", on);
  }, []);
  const pick = (k: string) => { setT(k); try { localStorage.setItem("gl.sub", k); } catch { /* ignore */ } };
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);
  return (
    <div className="fin-panel active">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {GL_TABS.map(([k, l]) => <button key={k} className={`btn sm ${t === k ? "primary" : ""}`} onClick={() => pick(k)}>{l}</button>)}
      </div>
      {t === "accounts" && <AccountsTab onOpen={setLedgerFor} />}
      {t === "journals" && <JournalsTab />}
      {t === "manual" && <ManualJournalsTab />}
      {t === "reports" && <GlReports onOpenAccount={setLedgerFor} />}
      {t === "periods" && <PeriodsTab />}
      {t === "setup" && <SetupTab />}
      {ledgerFor && <AccountLedgerModal code={ledgerFor} onClose={() => setLedgerFor(null)} />}
    </div>
  );
}

/* ---------- Chart of accounts ---------- */
function AccountsTab({ onOpen }: { onOpen: (code: string) => void }) {
  const { level, toast } = useApp();
  const canAdmin = level("finance") >= 3;
  const { accts, reloadAccts } = useAccounts();
  const [bal, setBal] = useState<Record<string, number>>({});
  const [edit, setEdit] = useState<Partial<Acct> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const loadBal = () => rpc("gl_trial_balance", { p_from: "0000-01", p_to: thisPeriod() }).then(({ data }) =>
    setBal(Object.fromEntries(((data?.rows ?? []) as any[]).map((r) => [r.code, Number(r.closing)]))));
  useEffect(() => { loadBal(); }, []);
  async function save() {
    if (!edit) return;
    const { error } = await rpc("gl_save_account", {
      p_code: edit.code, p_name: edit.name, p_kind: edit.kind, p_reconcilable: !!edit.reconcilable,
      p_manual_allowed: edit.manual_allowed !== false, p_active: edit.active !== false, p_description: edit.description ?? null,
    });
    if (error) { toast("Account not saved", error); return; }
    toast("Account saved", `${edit.code} ${edit.name}`); setEdit(null); reloadAccts(); loadBal();
  }
  // natural-sign balance: debit-normal for assets/expenses, credit-normal otherwise
  const nat = (a: Acct) => (a.kind === "asset" || a.kind === "expense" ? 1 : -1) * (bal[a.code] ?? 0);
  const shown = accts.filter((a) => showInactive || a.active);
  return (
    <>
      <div className="panel">
        <div className="panel-h"><h3>Chart of accounts</h3>
          <span className="meta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", ...sub }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> show inactive</label>
            {canAdmin && <a href="#" onClick={(e) => { e.preventDefault(); setEdit({ kind: "expense", active: true, manual_allowed: true }); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add account</a>}
          </span>
        </div>
        {KINDS.map((k) => {
          const rows = shown.filter((a) => a.kind === k);
          if (!rows.length) return null;
          return (
            <table className="tbl" key={k} style={{ marginBottom: 6 }}>
              <thead><tr><th style={{ width: 70 }}>{KIND_L[k]}</th><th /><th>Flags</th><th style={th}>Balance (KES)</th><th style={{ width: 60 }} /></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.code} style={{ opacity: a.active ? 1 : 0.5 }}>
                    <td className="mono">{a.code}</td>
                    <td><a href="#" onClick={(e) => { e.preventDefault(); onOpen(a.code); }} style={{ color: "inherit" }}>{a.name}</a>{a.description ? <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{a.description}</div> : null}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{[a.reconcilable && "reconcilable", !a.manual_allowed && "control a/c", !a.active && "inactive"].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="mono" style={th}>{signed(nat(a))}</td>
                    <td style={th}>{canAdmin && <button className="btn sm" onClick={() => setEdit({ ...a })}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
        <Note noBorder>Click an account to see its ledger. Control accounts (receivables, payables, employee advances) are fed only by their modules — never by a manual journal.</Note>
      </div>
      <ModalShell open={!!edit} onClose={() => setEdit(null)} width={480}>
        <div className="mh"><h3>{edit && accts.some((a) => a.code === edit.code) ? `Edit ${edit.code}` : "Add account"}</h3><p>The type decides where it lands: income & expense → P&L; asset, liability & equity → balance sheet.</p></div>
        {edit && <div className="mb">
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8 }}>
            <div><label>Code</label><input className="field" style={{ width: "100%" }} maxLength={4} disabled={accts.some((a) => a.code === edit.code)} value={edit.code ?? ""} onChange={(e) => setEdit({ ...edit, code: e.target.value.replace(/\D/g, "") })} placeholder="5170" /></div>
            <div><label>Name</label><input className="field" style={{ width: "100%" }} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          </div>
          <div><label>Type</label><select className="field" style={{ width: "100%" }} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_L[k]}</option>)}</select></div>
          <div><label>Description <span style={sub}>· optional</span></label><input className="field" style={{ width: "100%" }} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", ...sub }}><input type="checkbox" checked={!!edit.reconcilable} onChange={(e) => setEdit({ ...edit, reconcilable: e.target.checked })} /> Reconcilable bank / cash account (must reconcile before a period closes)</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", ...sub }}><input type="checkbox" checked={edit.manual_allowed !== false} onChange={(e) => setEdit({ ...edit, manual_allowed: e.target.checked })} /> Manual journals may post here (untick for control accounts)</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", ...sub }}><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
        </div>}
        <div className="mf"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save account</button></div>
      </ModalShell>
    </>
  );
}

/* ---------- Account ledger (GL detail) ---------- */
function AccountLedgerModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [from, setFrom] = useState(lastPeriods(3)[2]);
  const [to, setTo] = useState(thisPeriod());
  const [d, setD] = useState<any>(null);
  useEffect(() => { rpc("gl_account_ledger", { p_code: code, p_from: from, p_to: to }).then(({ data }) => setD(data)); }, [code, from, to]);
  const flip = d && !(d.kind === "asset" || d.kind === "expense") ? -1 : 1;
  return (
    <ModalShell open onClose={onClose} width={900}>
      <div className="mh"><h3>{code} · {d?.name ?? ""}</h3><p>Every posted line on this account, with its source and coding.</p></div>
      <div className="mb">
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>From <PeriodSelect value={from} onChange={setFrom} n={36} /> to <PeriodSelect value={to} onChange={setTo} n={36} />
          {d && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => downloadCsv(`ledger-${code}-${from}-${to}.csv`, [["Date", "Journal", "Source", "Source ref", "Memo", "Project", "Cost centre", "Fund", "Debit", "Credit", "Balance"],
            ...d.lines.map((l: any) => [l.date, l.ref, l.source, l.sourceRef, l.memo, l.project, l.costCentre, l.fund, l.debit, l.credit, l.balance * flip])])}>Export CSV</button>}
        </div>
        {!d ? <Empty>Loading…</Empty> : (
          <div style={{ maxHeight: 460, overflow: "auto" }}>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Journal</th><th>Memo · source</th><th>Coding</th><th style={th}>Debit</th><th style={th}>Credit</th><th style={th}>Balance</th></tr></thead>
              <tbody>
                <tr><td colSpan={6} style={{ color: "var(--ink-soft)" }}>Opening balance</td><td className="mono" style={th}>{signed(Number(d.opening) * flip)}</td></tr>
                {d.lines.map((l: any) => (
                  <tr key={l.id} style={{ opacity: l.state === "reversed" ? 0.6 : 1 }}>
                    <td className="mono" style={{ fontSize: 12 }}>{l.date}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{l.ref}{l.state === "reversed" ? " ↺" : ""}</td>
                    <td style={{ fontSize: 12 }}>{l.memo}<div style={{ color: "var(--ink-soft)", fontSize: 11 }}>{l.source} {l.sourceRef}</div></td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{[l.project, l.costCentre, l.fund].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="mono" style={th}>{Number(l.debit) ? money(l.debit) : ""}</td>
                    <td className="mono" style={th}>{Number(l.credit) ? money(l.credit) : ""}</td>
                    <td className="mono" style={th}>{signed(Number(l.balance) * flip)}</td>
                  </tr>
                ))}
                {!d.lines.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-soft)" }}>No postings in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mf"><button className="btn" onClick={onClose}>Close</button></div>
    </ModalShell>
  );
}

/* ---------- Journals (posted entries + audit trail) ---------- */
const SOURCES: [string, string][] = [["", "All sources"], ["sales_invoice", "Customer invoices"], ["receipt", "Customer receipts"], ["invoice_ap", "Supplier invoices"], ["payment", "Supplier payments"],
  ["petty_cash", "Petty cash"], ["expense_claim", "Expense claims"], ["travel_advance", "Travel advances"], ["recurring_bill", "Recurring bills"], ["payroll", "Payroll"], ["asset", "Depreciation"], ["manual_journal", "Manual journals"]];
function JournalsTab() {
  const { level, toast, goTab } = useApp();
  const canEdit = level("finance") >= 2;
  const [period, setPeriod] = useState(thisPeriod());
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const load = () => {
    let qb = supabase.from("journal_entries")
      .select("id, ref, memo, source_type, source_ref, entry_date, period, kind, state, reversal_of, reversed_by, created_at, journal_lines(id, account_code, debit, credit, project_code, cost_centre, fund_code, memo)")
      .eq("period", period).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
    if (source) qb = qb.eq("source_type", source);
    qb.then(({ data }) => setRows(data ?? []));
  };
  useEffect(load, [period, source]);
  useEffect(() => {
    if (!open) { setAudit([]); return; }
    const r = rows.find((x) => x.ref === open);
    const refs = [open, r?.source_ref].filter(Boolean);
    supabase.from("audit_log").select("action, actor_email, record_ref, detail, created_at").in("record_ref", refs).order("created_at").limit(50)
      .then(({ data }) => setAudit(data ?? []));
  }, [open]);
  const shown = rows.filter((r) => !q || `${r.ref} ${r.memo} ${r.source_ref}`.toLowerCase().includes(q.toLowerCase()));
  async function reverse(r: any) {
    const reason = window.prompt(`Why is ${r.ref} being reversed? (A reversal is a new journal that goes through approval.)`);
    if (!reason) return;
    const { error } = await rpc("start_journal_reversal", { p_je_ref: r.ref, p_reason: reason });
    if (error) { toast("Reversal not started", error); return; }
    toast("Reversal drafted", "Attach the support and submit it for approval under Manual journals");
    glOpenSub("manual"); goTab("finance", "f-gl");
  }
  const total = (r: any) => (r.journal_lines ?? []).reduce((s: number, l: any) => s + Number(l.debit), 0);
  return (
    <div className="panel">
      <div className="panel-h"><h3>Journal entries</h3>
        <span className="meta" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <PeriodSelect value={period} onChange={setPeriod} n={24} />
          <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="field" placeholder="Search ref / memo" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} />
        </span>
      </div>
      <table className="tbl">
        <thead><tr><th>Date</th><th>Journal</th><th>Memo</th><th>Source</th><th style={th}>Amount (KES)</th></tr></thead>
        <tbody>
          {!shown.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No journal entries in {periodLabel(period)}.</td></tr>}
          {shown.map((r) => (
            <Fragment key={r.ref}>
              <tr onClick={() => setOpen(open === r.ref ? null : r.ref)} style={{ cursor: "pointer", opacity: r.state === "reversed" ? 0.65 : 1 }}>
                <td className="mono" style={{ fontSize: 12 }}>{r.entry_date}</td>
                <td className="mono" style={{ fontSize: 12 }}>{r.ref}{r.kind !== "auto" && <span className="pill week" style={{ marginLeft: 6 }}>{r.kind}</span>}{r.state === "reversed" && <span className="pill over" style={{ marginLeft: 6 }}>reversed</span>}</td>
                <td style={{ fontSize: 12.5 }}>{r.memo}</td>
                <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{SOURCES.find(([k]) => k === r.source_type)?.[1] ?? r.source_type} · {r.source_ref}</td>
                <td className="mono" style={th}>{money(total(r))}</td>
              </tr>
              {open === r.ref && (
                <tr><td colSpan={5} style={{ background: "var(--wash, #F7F4EE)" }}>
                  <table className="tbl" style={{ margin: "4px 0" }}>
                    <thead><tr><th>Account</th><th>Coding</th><th>Line memo</th><th style={th}>Debit</th><th style={th}>Credit</th></tr></thead>
                    <tbody>{(r.journal_lines ?? []).map((l: any) => (
                      <tr key={l.id}><td className="mono">{l.account_code}</td><td style={{ fontSize: 12 }}>{[l.project_code, l.cost_centre, l.fund_code].filter(Boolean).join(" · ") || "—"}</td>
                        <td style={{ fontSize: 12 }}>{l.memo ?? ""}</td><td className="mono" style={th}>{Number(l.debit) ? money(l.debit) : ""}</td><td className="mono" style={th}>{Number(l.credit) ? money(l.credit) : ""}</td></tr>
                    ))}</tbody>
                  </table>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span>{r.reversal_of ? `Reverses ${r.reversal_of}. ` : ""}{r.reversed_by ? `Reversed by ${r.reversed_by}. ` : ""}Audit trail: {audit.length ? audit.map((a, i) => <span key={i}>{i ? " → " : ""}{a.action} ({a.actor_email ?? "system"}, {new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})</span>) : "—"}</span>
                    {canEdit && r.kind === "manual" && r.state !== "reversed" && <button className="btn sm" onClick={(e) => { e.stopPropagation(); reverse(r); }}>Reverse…</button>}
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <Note noBorder>Posted entries can't be edited or deleted. Module postings are corrected in their module (e.g. cancel the invoice); manual journals are corrected by an approved reversal.</Note>
    </div>
  );
}

/* ---------- Manual journals (+ opening balances, reversals) ---------- */
type MjLine = { account: string; debit: string; credit: string; project: string; costCentre: string; fund: string; memo: string };
const blankLine = (): MjLine => ({ account: "", debit: "", credit: "", project: "", costCentre: "", fund: "", memo: "" });
function ManualJournalsTab() {
  const { level, toast, me, appConfig } = useApp();
  const canEdit = level("finance") >= 2;
  const myAuth = (appConfig.gl_approvers ?? {})[(me?.email ?? "").toLowerCase()] as string | undefined;
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState("open");
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);
  const [openingDone, setOpeningDone] = useState(false);
  const load = () => {
    supabase.from("manual_journals").select("id, ref, kind, entry_date, memo, total, state, band_label, approvals, je_ref, created_by, reversal_of, created_at, creator:app_users!manual_journals_created_by_fkey(name, email)")
      .order("created_at", { ascending: false }).limit(200).then(({ data }) => setRows(data ?? []));
    supabase.from("journal_entries").select("ref").eq("kind", "opening").limit(1).then(({ data }) => setOpeningDone(!!data?.length));
  };
  useEffect(load, []);
  const shown = rows.filter((r) => filter === "all" || (filter === "open" ? ["draft", "submitted", "rejected"].includes(r.state) : r.state === filter));
  async function openFull(id: string, mode: "edit" | "view") {
    const { data } = await supabase.from("manual_journals").select("*").eq("id", id).single();
    if (!data) return;
    const full = { ...data, approvals: data.approvals ?? [] };
    if (mode === "edit") setEdit(full); else setView(full);
  }
  return (
    <>
      <div className="panel">
        <div className="panel-h"><h3>Manual journals</h3>
          <span className="meta" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[["open", "In progress"], ["posted", "Posted"], ["all", "All"]].map(([k, l]) => <button key={k} className={`btn sm ${filter === k ? "primary" : ""}`} onClick={() => setFilter(k)}>{l}</button>)}
            {canEdit && !openingDone && <button className="btn sm" onClick={() => setEdit({ kind: "opening", entry_date: keToday(), memo: "Opening balances at go-live", lines: [], attachments: [] })}>Opening balances</button>}
            {canEdit && <button className="btn sm primary" onClick={() => setEdit({ kind: "manual", entry_date: keToday(), memo: "", lines: [], attachments: [] })}><PlusI />New journal</button>}
          </span>
        </div>
        <table className="tbl">
          <thead><tr><th>Ref</th><th>Date</th><th>Memo</th><th>Prepared by</th><th>Approval</th><th style={th}>Amount (KES)</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!shown.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No manual journals here.</td></tr>}
            {shown.map((r) => {
              const st = MJ_STATES[r.state] ?? { l: r.state, cls: "week" };
              const mine = (r.creator?.email ?? "").toLowerCase() === (me?.email ?? "").toLowerCase();
              return (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12 }}>{r.ref}{r.kind !== "manual" && <span className="pill week" style={{ marginLeft: 6 }}>{r.kind}</span>}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.entry_date}</td>
                  <td style={{ fontSize: 12.5 }}>{r.memo || "—"}{r.reversal_of ? <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>reverses {r.reversal_of}</div> : null}</td>
                  <td style={{ fontSize: 12 }}>{r.creator?.name ?? "—"}</td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{r.band_label ?? "—"}{(r.approvals ?? []).length ? <div>✓ {(r.approvals ?? []).map((a: any) => a.name).join(", ")}</div> : null}</td>
                  <td className="mono" style={th}>{money(r.total)}</td>
                  <td><span className={`pill ${st.cls}`}>{st.l}</span>{r.je_ref ? <div className="mono" style={{ fontSize: 11 }}>{r.je_ref}</div> : null}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canEdit && mine && ["draft", "rejected"].includes(r.state)
                      ? <button className="btn sm" onClick={() => openFull(r.id, "edit")}>Open</button>
                      : <button className={`btn sm ${r.state === "submitted" && myAuth && !mine ? "primary" : ""}`} onClick={() => openFull(r.id, "view")}>{r.state === "submitted" && myAuth && !mine ? "Review" : "View"}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Note noBorder>Manual journals are for accruals, prepayments, reclassifications, corrections and year-end entries — never for something a module already posts. Each needs supporting documents and approval per IGN-FIN-001; the preparer can't approve their own.{myAuth ? ` You approve as ${authLabel(myAuth)}.` : ""}</Note>
      </div>
      {edit && <JournalEditor mj={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {view && <JournalReview mj={view} onClose={() => setView(null)} onDone={() => { setView(null); load(); }} myAuth={myAuth} />}
    </>
  );
}

function JournalEditor({ mj, onClose, onDone }: { mj: any; onClose: () => void; onDone: () => void }) {
  const { toast, uploadFiles, projectDetails } = useApp();
  const { accts } = useAccounts();
  const [funds, setFunds] = useState<any[]>([]);
  useEffect(() => { supabase.from("gl_funds").select("code, name").eq("active", true).order("code").then(({ data }) => setFunds(data ?? [])); }, []);
  const isOpening = mj.kind === "opening", isRev = mj.kind === "reversal";
  const toLine = (l: any): MjLine => ({ account: l.account ?? "", debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "",
    project: l.project ?? "", costCentre: l.costCentre ?? "", fund: l.fund ?? "", memo: l.memo ?? "" });
  const [date, setDate] = useState<string>(mj.entry_date ?? keToday());
  const [memo, setMemo] = useState<string>(mj.memo ?? "");
  const [lines, setLines] = useState<MjLine[]>(() => (mj.lines ?? []).length ? mj.lines.map(toLine)
    : isOpening ? accts.length ? [] : [blankLine(), blankLine()] : [blankLine(), blankLine()]);
  const [paths, setPaths] = useState<string[]>(mj.attachments ?? []);
  const [busy, setBusy] = useState(false);
  // opening balances: one row per balance-sheet account, the balancing figure goes to 3900
  useEffect(() => {
    if (isOpening && !(mj.lines ?? []).length && accts.length && !lines.length)
      setLines(accts.filter((a) => a.active && ["asset", "liability", "equity"].includes(a.kind) && a.code !== "3900").map((a) => ({ ...blankLine(), account: a.code })));
  }, [accts]);
  const allowed = accts.filter((a) => a.active && (isOpening || isRev || a.manual_allowed));
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const openingEquity = "3900";
  const setLine = (i: number, p: Partial<MjLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const payload = () => {
    let ls = lines.filter((l) => l.account && (Number(l.debit) || Number(l.credit)));
    if (isOpening && Math.abs(diff) >= 0.005) ls = [...ls, { ...blankLine(), account: openingEquity, debit: diff < 0 ? String(-diff) : "", credit: diff > 0 ? String(diff) : "", memo: "Opening balance equity" }];
    return { kind: isRev ? undefined : mj.kind, date, memo, attachments: paths,
      lines: ls.map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, project: l.project || null, costCentre: l.costCentre || null, fund: l.fund || null, memo: l.memo || null })) };
  };
  async function save(submit: boolean) {
    setBusy(true);
    const s = await rpc("save_manual_journal", { p_id: mj.id ?? null, p_data: payload() });
    if (s.error) { toast("Journal not saved", s.error); setBusy(false); return; }
    if (submit) {
      const r = await rpc("submit_manual_journal", { p_id: s.data.id });
      if (r.error) { toast("Saved as draft — not submitted", r.error); setBusy(false); onDone(); return; }
      toast(`${r.data.ref} submitted`, `Needs ${r.data.bandLabel}`);
    } else toast(`${s.data.ref} saved`, "Draft — nothing is posted until it is approved");
    onDone();
  }
  const projects = Object.keys(projectDetails);
  return (
    <ModalShell open onClose={onClose} width={1040}>
      <div className="mh"><h3>{isOpening ? "Opening balances" : isRev ? `Reversal of ${mj.reversal_of}` : mj.ref ? `Journal ${mj.ref}` : "New manual journal"}</h3>
        <p>{isOpening ? "Enter each balance-sheet account's balance at the cut-over date (debit for assets, credit for liabilities). The balancing figure goes to 3900 Opening balance equity. Once approved it is posted and locked."
          : isRev ? "Every line of the original is flipped. Attach the reason / support and submit it for approval." : "Debits must equal credits. Nothing posts until it is approved."}</p>
        {mj.reject_reason && <p style={{ color: "var(--red)" }}>Rejected: {mj.reject_reason}</p>}
      </div>
      <div className="mb">
        <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10 }}>
          <div><label>{isOpening ? "Cut-over date" : "Journal date"}</label><input className="field" type="date" style={{ width: "100%" }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label>What is it for?</label><input className="field" style={{ width: "100%" }} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Accrue September audit fee" /></div>
        </div>
        <datalist id="gl-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
        <div style={{ maxHeight: 380, overflow: "auto" }}>
          <table className="tbl">
            <thead><tr><th style={{ width: 230 }}>Account</th><th style={{ width: 110 }}>Debit</th><th style={{ width: 110 }}>Credit</th><th>Project</th><th style={{ width: 90 }}>Cost centre</th><th style={{ width: 100 }}>Fund</th><th>Line memo</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><select className="field" style={{ width: "100%" }} disabled={isRev} value={l.account} onChange={(e) => setLine(i, { account: e.target.value })}>
                    <option value="">— account —</option>{allowed.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td>
                  <td><input className="field mono" style={{ width: "100%" }} type="number" min="0" step="0.01" disabled={isRev} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                  <td><input className="field mono" style={{ width: "100%" }} type="number" min="0" step="0.01" disabled={isRev} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                  <td><input className="field" style={{ width: "100%" }} list="gl-projects" disabled={isRev} value={l.project} onChange={(e) => setLine(i, { project: e.target.value })} /></td>
                  <td><input className="field" style={{ width: "100%" }} disabled={isRev} value={l.costCentre} onChange={(e) => setLine(i, { costCentre: e.target.value })} placeholder="HQ" /></td>
                  <td><select className="field" style={{ width: "100%" }} disabled={isRev} value={l.fund} onChange={(e) => setLine(i, { fund: e.target.value })}><option value="">—</option>{funds.map((f) => <option key={f.code} value={f.code}>{f.code}</option>)}</select></td>
                  <td><input className="field" style={{ width: "100%" }} disabled={isRev} value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} /></td>
                  <td>{!isRev && <button className="btn" style={{ padding: "3px 7px", fontSize: 11, color: "var(--red)" }} onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, k) => k !== i) : [blankLine()])}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isRev && <a href="#" onClick={(e) => { e.preventDefault(); setLines((ls) => [...ls, blankLine()]); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12.5 }}>+ Add line</a>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>
          <div><label>Supporting documents <span style={sub}>· required to submit</span></label>
            <ReceiptList paths={paths} addLabel="Attach documents" busy={busy}
              onAdd={async (files) => { setBusy(true); const p = await uploadFiles("gl-journals", files); setPaths((x) => [...x, ...p]); setBusy(false); }}
              onRemove={(p) => setPaths((x) => x.filter((y) => y !== p))} />
          </div>
          <div className="reqbox" style={{ background: "#FCFAF6", borderColor: "transparent", color: "var(--ink)" }}>
            <div className="recon"><span>Debits</span><span className="mono">{money(dr)}</span></div>
            <div className="recon"><span>Credits</span><span className="mono">{money(cr)}</span></div>
            {isOpening
              ? <div className="recon"><span>To 3900 Opening equity</span><span className="mono">{diff ? `${diff > 0 ? "Cr" : "Dr"} ${money(Math.abs(diff))}` : "—"}</span></div>
              : <div className="recon" style={{ fontWeight: 700, color: diff ? "var(--red)" : "var(--green, #2F7D4F)" }}><span>{diff ? "Out of balance" : "Balanced"}</span><span className="mono">{diff ? money(Math.abs(diff)) : "✓"}</span></div>}
          </div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={onClose}>Cancel</button>
        {mj.id && <button className="btn" style={{ color: "var(--red)" }} disabled={busy} onClick={async () => { if (!window.confirm("Delete this draft?")) return; const r = await rpc("delete_manual_journal", { p_id: mj.id }); if (r.error) toast("Not deleted", r.error); else onDone(); }}>Delete draft</button>}
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={busy} onClick={() => save(true)}>Submit for approval</button>
      </div>
    </ModalShell>
  );
}

function JournalReview({ mj, onClose, onDone, myAuth }: { mj: any; onClose: () => void; onDone: () => void; myAuth?: string }) {
  const { toast, me } = useApp();
  const [creator, setCreator] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => { supabase.from("app_users").select("name, email").eq("id", mj.created_by).maybeSingle().then(({ data }) => setCreator(data)); }, [mj.created_by]);
  const mine = (creator?.email ?? "").toLowerCase() === (me?.email ?? "").toLowerCase();
  const already = (mj.approvals ?? []).some((a: any) => a.email === (me?.email ?? "").toLowerCase());
  const canAct = mj.state === "submitted" && !!myAuth && !mine && !already;
  const slotsText = (mj.slots ?? []).map((s: string[]) => s.map(authLabel).join(" / ")).join("  +  ");
  async function act(approve: boolean) {
    const r = approve ? await rpc("approve_manual_journal", { p_id: mj.id }) : await rpc("reject_manual_journal", { p_id: mj.id, p_reason: reason });
    if (r.error) { toast(approve ? "Not approved" : "Not rejected", r.error); return; }
    toast(approve ? (r.data.state === "posted" ? `${mj.ref} posted → ${r.data.jeRef}` : `${mj.ref} approved`) : `${mj.ref} rejected`,
      approve && r.data.state !== "posted" ? "Still needs another approver" : "");
    onDone();
  }
  return (
    <ModalShell open onClose={onClose} width={860}>
      <div className="mh"><h3>{mj.ref} <span className={`pill ${(MJ_STATES[mj.state] ?? { cls: "week" }).cls}`} style={{ marginLeft: 6 }}>{(MJ_STATES[mj.state] ?? { l: mj.state }).l}</span></h3>
        <p>{mj.memo} · {mj.entry_date} · prepared by {creator?.name ?? "—"}{mj.reversal_of ? ` · reverses ${mj.reversal_of}` : ""}</p></div>
      <div className="mb">
        <table className="tbl">
          <thead><tr><th>Account</th><th>Coding</th><th>Memo</th><th style={th}>Debit</th><th style={th}>Credit</th></tr></thead>
          <tbody>{(mj.lines ?? []).map((l: any, i: number) => (
            <tr key={i}><td className="mono">{l.account}</td><td style={{ fontSize: 12 }}>{[l.project, l.costCentre, l.fund].filter(Boolean).join(" · ") || "—"}</td><td style={{ fontSize: 12 }}>{l.memo ?? ""}</td>
              <td className="mono" style={th}>{Number(l.debit) ? money(l.debit) : ""}</td><td className="mono" style={th}>{Number(l.credit) ? money(l.credit) : ""}</td></tr>
          ))}</tbody>
        </table>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><label>Supporting documents</label>{(mj.attachments ?? []).length ? <ReceiptList paths={mj.attachments} readOnly /> : <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>None</div>}</div>
          <div style={{ fontSize: 12.5 }}>
            <div><strong>Band:</strong> {mj.band_label ?? "—"}</div>
            {slotsText && <div><strong>Needs:</strong> {slotsText}</div>}
            <div><strong>Approved by:</strong> {(mj.approvals ?? []).length ? (mj.approvals ?? []).map((a: any) => `${a.name} (${authLabel(a.authority)})`).join(", ") : "—"}</div>
            {mj.je_ref && <div><strong>Posted as:</strong> <span className="mono">{mj.je_ref}</span></div>}
            {mj.reject_reason && <div style={{ color: "var(--red)" }}><strong>Rejected:</strong> {mj.reject_reason}</div>}
          </div>
        </div>
        {rejecting && <div><label>Reason for rejecting</label><input className="field" style={{ width: "100%" }} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        {mj.state === "submitted" && !canAct && <Note>{mine ? "You prepared this journal — someone else must approve it." : already ? "You've approved it — waiting for the next approver." : !myAuth ? "You're not set up as a journal approver (General Ledger → Setup)." : ""}</Note>}
      </div>
      <div className="mf">
        <button className="btn" onClick={onClose}>Close</button>
        {canAct && (rejecting
          ? <button className="btn" style={{ color: "var(--red)" }} onClick={() => { if (!reason.trim()) { toast("Give a reason", "Why is it being rejected?"); return; } act(false); }}>Confirm reject</button>
          : <button className="btn" style={{ color: "var(--red)" }} onClick={() => setRejecting(true)}>Reject…</button>)}
        {canAct && <button className="btn primary" onClick={() => act(true)}>Approve as {authLabel(myAuth!)}</button>}
      </div>
    </ModalShell>
  );
}

/* ---------- Reports: TB · P&L · Balance sheet · Project actuals · Statutory ---------- */
export function GlReports({ onOpenAccount }: { onOpenAccount?: (c: string) => void }) {
  const [rep, setRep] = useState("pl");
  const [from, setFrom] = useState(`${thisPeriod().slice(0, 4)}-01`);
  const [to, setTo] = useState(thisPeriod());
  const [project, setProject] = useState("");
  const [fund, setFund] = useState("");
  const [res, setRes] = useState<{ key: string; data: any } | null>(null);
  const { projectDetails } = useApp();
  const [funds, setFunds] = useState<any[]>([]);
  useEffect(() => { supabase.from("gl_funds").select("code, name").order("code").then(({ data }) => setFunds(data ?? [])); }, []);
  const key = [rep, from, to, project, fund].join("|");
  const d = res && res.key === key ? res.data : null;   // never render one report with another's data
  useEffect(() => {
    const call = rep === "tb" ? rpc("gl_trial_balance", { p_from: from, p_to: to })
      : rep === "pl" ? rpc("gl_income_statement", { p_from: from, p_to: to, p_project: project || null, p_fund: fund || null })
      : rep === "bs" || rep === "stat" ? rpc("gl_balance_sheet", { p_to: to })
      : rpc("gl_project_actuals", { p_from: from, p_to: to });
    call.then(({ data }) => setRes({ key, data }));
  }, [key]);
  const acctLink = (code: string, name: string) => onOpenAccount ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenAccount(code); }} style={{ color: "inherit" }}>{name}</a> : name;
  const range = `${periodLabel(from)} – ${periodLabel(to)}`;
  const Row = ({ l, v, b, code }: { l: string; v: number; b?: boolean; code?: string }) => (
    <tr style={b ? { fontWeight: 700 } : undefined}><td>{code ? <span className="mono" style={{ color: "var(--ink-soft)", marginRight: 8 }}>{code}</span> : null}{code ? acctLink(code, l) : l}</td><td className="mono" style={th}>{signed(v)}</td></tr>
  );
  function exportCsv() {
    if (!d) return;
    if (rep === "tb") downloadCsv(`trial-balance-${from}-${to}.csv`, [["Code", "Account", "Type", "Opening", "Debit", "Credit", "Closing"], ...d.rows.map((r: any) => [r.code, r.name, r.kind, r.opening, r.debit, r.credit, r.closing])]);
    if (rep === "pl") downloadCsv(`income-statement-${from}-${to}.csv`, [["Section", "Code", "Account", "Amount"], ...d.income.map((r: any) => ["Income", r.code, r.name, r.amount]), ...d.expense.map((r: any) => ["Expense", r.code, r.name, r.amount]), ["Net", "", "", d.net]]);
    if (rep === "bs") downloadCsv(`balance-sheet-${to}.csv`, [["Section", "Code", "Account", "Amount"], ...d.assets.map((r: any) => ["Assets", r.code, r.name, r.amount]), ...d.liabilities.map((r: any) => ["Liabilities", r.code, r.name, r.amount]), ...d.equity.map((r: any) => ["Equity", r.code, r.name, r.amount]), ["Equity", "", "Current earnings", d.currentEarnings]]);
    if (rep === "pa") downloadCsv(`project-actuals-${from}-${to}.csv`, [["Project / cost centre", "Fund", "Budget", "Expense", "Income"], ...d.map((r: any) => [r.project, r.fund, r.budget, r.expense, r.income])]);
  }
  const statCodes = ["2100", "2200", "2210", "2220", "2230", "2240", "2250"];
  return (
    <div className="panel">
      <div className="panel-h"><h3>Financial reports</h3>
        <span className="meta" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {[["pl", "Income statement"], ["bs", "Balance sheet"], ["tb", "Trial balance"], ["pa", "Project actuals"], ["stat", "Statutory"]].map(([k, l]) => <button key={k} className={`btn sm ${rep === k ? "primary" : ""}`} onClick={() => setRep(k)}>{l}</button>)}
        </span>
      </div>
      <div className="pad" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
        {rep !== "bs" && rep !== "stat" && <>From <PeriodSelect value={from} onChange={setFrom} n={36} /></>}
        {rep === "bs" || rep === "stat" ? "As at end of" : "to"} <PeriodSelect value={to} onChange={setTo} n={36} />
        {rep === "pl" && <>
          <input className="field" list="gl-rep-projects" placeholder="All projects" value={project} onChange={(e) => setProject(e.target.value)} style={{ width: 180 }} />
          <datalist id="gl-rep-projects">{Object.keys(projectDetails).map((p) => <option key={p} value={p} />)}</datalist>
          <select className="field" value={fund} onChange={(e) => setFund(e.target.value)}><option value="">All funds</option>{funds.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}</select>
        </>}
        {rep !== "stat" && <button className="btn sm" style={{ marginLeft: "auto" }} disabled={!d} onClick={exportCsv}>Export CSV</button>}
      </div>
      {!d ? <Empty>Loading…</Empty> : rep === "pl" ? (
        <table className="tbl">
          <thead><tr><th>Income statement · {range}{project ? ` · ${project}` : ""}{fund ? ` · ${fund}` : ""}</th><th style={th}>KES</th></tr></thead>
          <tbody>
            <tr><td colSpan={2} style={{ fontWeight: 600, color: "var(--flame)" }}>Income</td></tr>
            {d.income.map((r: any) => <Row key={r.code} code={r.code} l={r.name} v={Number(r.amount)} />)}
            <Row l="Total income" v={Number(d.totalIncome)} b />
            <tr><td colSpan={2} style={{ fontWeight: 600, color: "var(--flame)" }}>Expenses</td></tr>
            {d.expense.map((r: any) => <Row key={r.code} code={r.code} l={r.name} v={Number(r.amount)} />)}
            <Row l="Total expenses" v={Number(d.totalExpense)} b />
            <Row l={Number(d.net) >= 0 ? "Surplus for the period" : "Deficit for the period"} v={Number(d.net)} b />
          </tbody>
        </table>
      ) : rep === "bs" ? (
        <table className="tbl">
          <thead><tr><th>Balance sheet · as at end of {periodLabel(to)}</th><th style={th}>KES</th></tr></thead>
          <tbody>
            <tr><td colSpan={2} style={{ fontWeight: 600, color: "var(--flame)" }}>Assets</td></tr>
            {d.assets.map((r: any) => <Row key={r.code} code={r.code} l={r.name} v={Number(r.amount)} />)}
            <Row l="Total assets" v={Number(d.totalAssets)} b />
            <tr><td colSpan={2} style={{ fontWeight: 600, color: "var(--flame)" }}>Liabilities</td></tr>
            {d.liabilities.map((r: any) => <Row key={r.code} code={r.code} l={r.name} v={Number(r.amount)} />)}
            <Row l="Total liabilities" v={Number(d.totalLiabilities)} b />
            <tr><td colSpan={2} style={{ fontWeight: 600, color: "var(--flame)" }}>Equity</td></tr>
            {d.equity.map((r: any) => <Row key={r.code} code={r.code} l={r.name} v={Number(r.amount)} />)}
            <Row l="Current earnings (unclosed P&L)" v={Number(d.currentEarnings)} />
            <Row l="Total equity" v={Number(d.totalEquity)} b />
            <tr><td>Check: assets − (liabilities + equity)</td><td style={th}>{Math.abs(Number(d.totalAssets) - Number(d.totalLiabilities) - Number(d.totalEquity)) < 0.005 ? <span className="pill done">Balances</span> : <span className="pill over">{money(Number(d.totalAssets) - Number(d.totalLiabilities) - Number(d.totalEquity))}</span>}</td></tr>
          </tbody>
        </table>
      ) : rep === "tb" ? (
        <table className="tbl">
          <thead><tr><th>Account</th><th style={th}>Opening</th><th style={th}>Debit</th><th style={th}>Credit</th><th style={th}>Closing</th></tr></thead>
          <tbody>
            {d.rows.map((r: any) => (
              <tr key={r.code}><td><span className="mono" style={{ color: "var(--ink-soft)", marginRight: 8 }}>{r.code}</span>{acctLink(r.code, r.name)}</td>
                <td className="mono" style={th}>{signed(Number(r.opening))}</td><td className="mono" style={th}>{money(r.debit)}</td><td className="mono" style={th}>{money(r.credit)}</td><td className="mono" style={th}>{signed(Number(r.closing))}</td></tr>
            ))}
            <tr style={{ fontWeight: 700 }}><td>Totals · {range}</td><td /><td className="mono" style={th}>{money(d.totalDebit)}</td><td className="mono" style={th}>{money(d.totalCredit)}</td>
              <td style={th}>{Math.abs(Number(d.totalDebit) - Number(d.totalCredit)) < 0.005 ? <span className="pill done">Agrees</span> : <span className="pill over">Out</span>}</td></tr>
          </tbody>
        </table>
      ) : rep === "pa" ? (
        <table className="tbl">
          <thead><tr><th>Project / cost centre</th><th>Fund</th><th style={th}>Budget</th><th style={th}>Actual spend</th><th style={th}>Income</th><th style={th}>Used</th></tr></thead>
          <tbody>
            {!d.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)" }}>No coded income or expense in {range}.</td></tr>}
            {d.map((r: any) => (
              <tr key={r.project}><td>{r.project}</td><td style={{ fontSize: 12 }}>{r.fund ?? "—"}</td><td className="mono" style={th}>{r.budget ? money(r.budget) : "—"}</td>
                <td className="mono" style={th}>{money(r.expense)}</td><td className="mono" style={th}>{money(r.income)}</td>
                <td style={th}>{r.budget ? `${Math.round(Number(r.expense) / Number(r.budget) * 100)}%` : "—"}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="tbl">
          <thead><tr><th>Statutory liability · as at end of {periodLabel(to)}</th><th style={th}>Owed (KES)</th></tr></thead>
          <tbody>
            {statCodes.map((c) => { const r = d.liabilities.find((x: any) => x.code === c); return <Row key={c} code={c} l={r?.name ?? c} v={Number(r?.amount ?? 0)} />; })}
          </tbody>
        </table>
      )}
      <Note noBorder>Every figure is read from posted ledger lines — nothing is re-keyed. Project actuals are every expense / income line carrying that project's code.</Note>
    </div>
  );
}

/* ---------- Periods ---------- */
function PeriodsTab() {
  const { level, toast } = useApp();
  const canClose = level("finance") >= 3;
  const [rows, setRows] = useState<Record<string, any>>({});
  const [sel, setSel] = useState(thisPeriod());
  const [chk, setChk] = useState<any>(null);
  const load = () => supabase.from("gl_periods").select("period, state, closed_at, reconciled_at, tb_agreed_at, reported_at").then(({ data }) => setRows(Object.fromEntries((data ?? []).map((r: any) => [r.period, r]))));
  useEffect(() => { load(); }, []);
  useEffect(() => { setChk(null); rpc("gl_period_checks", { p_period: sel }).then(({ data }) => setChk(data)); }, [sel]);
  const order = ["open", "reconciled", "tb_agreed", "closed", "reported"];
  const next = chk ? order[order.indexOf(chk.state) + 1] : null;
  async function advance() {
    if (!next) return;
    if (next === "closed" && !window.confirm(`Close ${periodLabel(sel)}? A closed period cannot be posted into or edited — later corrections go in as dated adjustments in an open period.`)) return;
    const { data, error } = await rpc("gl_advance_period", { p_period: sel, p_to: next });
    if (error) { toast("Period not moved", error); return; }
    toast(`${periodLabel(sel)} → ${PERIOD_STATES[next].l}`, ""); setChk(data); load();
  }
  return (
    <div className="grid g-2">
      <div className="panel">
        <div className="panel-h"><h3>Accounting periods</h3><span className="meta">Open → Reconciled → TB agreed → Closed → Reported</span></div>
        <table className="tbl">
          <tbody>{lastPeriods(15).map((p) => {
            const st = PERIOD_STATES[rows[p]?.state ?? "open"];
            return <tr key={p} onClick={() => setSel(p)} style={{ cursor: "pointer", background: sel === p ? "var(--flame-soft)" : undefined }}>
              <td>{periodLabel(p)}</td><td><span className={`pill ${st.cls}`}>{st.l}</span></td>
              <td style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{rows[p]?.closed_at ? `closed ${new Date(rows[p].closed_at).toLocaleDateString("en-GB")}` : ""}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <div className="panel">
        <div className="panel-h"><h3>{periodLabel(sel)}</h3>{chk && <span className={`pill ${PERIOD_STATES[chk.state].cls}`}>{PERIOD_STATES[chk.state].l}</span>}</div>
        {!chk ? <Empty>Loading…</Empty> : <div className="pad">
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>1 · Bank & cash reconciled</div>
          {chk.accounts.map((a: any) => (
            <div className="recon" key={a.code}><span>{a.code} {a.name}{!a.active && <span style={{ color: "var(--ink-soft)" }}> · no activity</span>}</span>
              <span>{a.rec?.state === "reconciled" ? <span className="pill done">Reconciled</span> : a.rec?.state === "difference" ? <span className="pill over">Diff {money(a.rec.difference)}</span> : a.active ? <span className="pill today">Not yet</span> : <span className="pill week">n/a</span>}</span></div>
          ))}
          <div style={{ fontWeight: 600, fontSize: 12.5, margin: "10px 0 4px" }}>2 · Trial balance agrees</div>
          <div className="recon"><span>Debits {money(chk.tb.totalDebit)} · Credits {money(chk.tb.totalCredit)}</span>
            <span>{Math.abs(Number(chk.tb.totalDebit) - Number(chk.tb.totalCredit)) < 0.005 ? <span className="pill done">Agrees</span> : <span className="pill over">Out</span>}</span></div>
          <div style={{ fontWeight: 600, fontSize: 12.5, margin: "10px 0 4px" }}>3 · Ready to close</div>
          <div className="recon"><span>Journals awaiting approval dated this month</span><span className="mono">{chk.pendingJournals}</span></div>
          <div className="recon"><span>Earlier periods still open</span><span style={{ fontSize: 12 }}>{chk.earlierOpen.length ? chk.earlierOpen.map(periodLabel).join(", ") : "none"}</span></div>
          {canClose && next && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={advance}>Mark {PERIOD_STATES[next].l.toLowerCase()}</button></div>}
          <Note noBorder>A period doesn't close until every bank and cash account reconciles and the trial balance agrees. Once closed, nothing can be posted into it — corrections are dated adjustments in an open period.</Note>
        </div>}
      </div>
    </div>
  );
}

/* ---------- Setup: mappings · funds · approvers ---------- */
function SetupTab() {
  const { level, toast, appConfig, setAppConfig, projectDetails, members } = useApp();
  const canAdmin = level("finance") >= 3;
  const { accts } = useAccounts();
  const [maps, setMaps] = useState<any[]>([]);
  const [funds, setFunds] = useState<any[]>([]);
  const [projFunds, setProjFunds] = useState<Record<string, string | null>>({});
  const [newFund, setNewFund] = useState({ code: "", name: "", donor: "", restricted: true });
  const [appr, setAppr] = useState<Record<string, string>>({});
  const [newAppr, setNewAppr] = useState({ email: "", authority: "md" });
  const load = () => {
    supabase.from("gl_mappings").select("event, role, account_code, label").order("event").order("role").then(({ data }) => setMaps(data ?? []));
    supabase.from("gl_funds").select("*").order("code").then(({ data }) => setFunds(data ?? []));
    supabase.from("projects").select("name, fund_code").order("name").then(({ data }) => setProjFunds(Object.fromEntries((data ?? []).map((p: any) => [p.name, p.fund_code]))));
  };
  useEffect(load, []);
  useEffect(() => { setAppr({ ...(appConfig.gl_approvers ?? {}) }); }, [appConfig.gl_approvers]);
  const events = useMemo(() => Array.from(new Set(maps.map((m) => m.event))), [maps]);
  const bands: any[] = Array.isArray(appConfig.gl_journal_bands) ? appConfig.gl_journal_bands : [];
  async function setMap(m: any, code: string) {
    const { error } = await rpc("gl_set_mapping", { p_event: m.event, p_role: m.role, p_account: code });
    if (error) { toast("Mapping not changed", error); return; }
    toast("Mapping changed", `${m.label ?? m.event + "/" + m.role} → ${code}`); load();
  }
  async function saveFund() {
    const { error } = await rpc("gl_save_fund", { p_code: newFund.code.toUpperCase(), p_name: newFund.name, p_donor: newFund.donor || null, p_restricted: newFund.restricted, p_active: true });
    if (error) { toast("Fund not saved", error); return; }
    setNewFund({ code: "", name: "", donor: "", restricted: true }); load();
  }
  async function setProjFund(p: string, f: string) {
    const { error } = await rpc("gl_set_project_fund", { p_project: p, p_fund: f || null });
    if (error) { toast("Not saved", error); return; }
    setProjFunds((x) => ({ ...x, [p]: f || null }));
  }
  const saveAppr = (next: Record<string, string>) => setAppConfig("gl_approvers", next);
  return (
    <>
      <div className="panel">
        <div className="panel-h"><h3>Account mappings</h3><span className="meta">which account each module posts to — configuration, not code</span></div>
        <table className="tbl">
          <thead><tr><th>Module event</th><th>Posting</th><th style={{ width: 300 }}>Account</th></tr></thead>
          <tbody>{events.map((ev) => maps.filter((m) => m.event === ev).map((m, i) => (
            <tr key={ev + m.role}>
              <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{i === 0 ? ev.replace(/_/g, " ") : ""}</td>
              <td style={{ fontSize: 12.5 }}>{m.label ?? m.role}</td>
              <td><select className="field" style={{ width: "100%" }} disabled={!canAdmin} value={m.account_code} onChange={(e) => setMap(m, e.target.value)}>
                {accts.filter((a) => a.active || a.code === m.account_code).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td>
            </tr>
          )))}</tbody>
        </table>
        <Note noBorder>A change applies to the next posting; entries already posted keep the account they were posted to.</Note>
      </div>
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-h"><h3>Funds</h3><span className="meta">donor / restricted funds (D1)</span></div>
          <table className="tbl">
            <thead><tr><th>Code</th><th>Fund</th><th>Donor</th><th>Restricted</th></tr></thead>
            <tbody>{funds.map((f) => <tr key={f.code}><td className="mono">{f.code}</td><td>{f.name}</td><td style={{ fontSize: 12 }}>{f.donor ?? "—"}</td><td>{f.restricted ? "Yes" : "No"}</td></tr>)}</tbody>
          </table>
          {canAdmin && <div className="pad" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input className="field" style={{ width: 80 }} placeholder="CODE" value={newFund.code} onChange={(e) => setNewFund({ ...newFund, code: e.target.value.toUpperCase() })} />
            <input className="field" style={{ width: 150 }} placeholder="Fund name" value={newFund.name} onChange={(e) => setNewFund({ ...newFund, name: e.target.value })} />
            <input className="field" style={{ width: 120 }} placeholder="Donor" value={newFund.donor} onChange={(e) => setNewFund({ ...newFund, donor: e.target.value })} />
            <label style={{ display: "flex", gap: 4, alignItems: "center", ...sub }}><input type="checkbox" checked={newFund.restricted} onChange={(e) => setNewFund({ ...newFund, restricted: e.target.checked })} /> restricted</label>
            <button className="btn sm" onClick={saveFund}>Add fund</button>
          </div>}
          <div className="panel-h" style={{ borderTop: "1px solid var(--line)" }}><h3>Project → fund</h3><span className="meta">lines coded to a project inherit its fund</span></div>
          <table className="tbl"><tbody>{Object.keys(projFunds).map((p) => (
            <tr key={p}><td style={{ fontSize: 12.5 }}>{p}</td><td style={{ width: 170 }}>
              <select className="field" style={{ width: "100%" }} disabled={!canAdmin} value={projFunds[p] ?? ""} onChange={(e) => setProjFund(p, e.target.value)}>
                <option value="">— none —</option>{funds.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.name}</option>)}</select></td></tr>
          ))}{!Object.keys(projFunds).length && <tr><td style={{ color: "var(--ink-soft)" }}>No projects yet.</td></tr>}</tbody></table>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Journal approvers</h3><span className="meta">IGN-FIN-001 authority</span></div>
          <table className="tbl"><tbody>
            {Object.entries(appr).map(([email, a]) => (
              <tr key={email}><td style={{ fontSize: 12.5 }}>{members.find((m) => m.email.toLowerCase() === email)?.name ?? email}<div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{email}</div></td>
                <td>{authLabel(a)}</td>
                <td style={th}>{canAdmin && <button className="btn sm" style={{ color: "var(--red)" }} onClick={() => { const n = { ...appr }; delete n[email]; saveAppr(n); }}>Remove</button>}</td></tr>
            ))}
            {!Object.keys(appr).length && <tr><td style={{ color: "var(--ink-soft)" }}>No approvers yet — manual journals can't be approved until someone is set up.</td></tr>}
          </tbody></table>
          {canAdmin && <div className="pad" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select className="field" style={{ flex: 1 }} value={newAppr.email} onChange={(e) => setNewAppr({ ...newAppr, email: e.target.value })}>
              <option value="">— person —</option>{members.map((m) => <option key={m.email} value={m.email.toLowerCase()}>{m.name}</option>)}</select>
            <select className="field" value={newAppr.authority} onChange={(e) => setNewAppr({ ...newAppr, authority: e.target.value })}>{AUTHORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="btn sm" onClick={() => { if (!newAppr.email) return; saveAppr({ ...appr, [newAppr.email]: newAppr.authority }); setNewAppr({ email: "", authority: "md" }); }}>Set</button>
          </div>}
          <div className="panel-h" style={{ borderTop: "1px solid var(--line)" }}><h3>Approval bands</h3><span className="meta">by journal amount (KES)</span></div>
          <table className="tbl"><tbody>{bands.map((b, i) => (
            <tr key={i}><td style={{ fontSize: 12.5 }}>{b.label}</td><td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{(b.slots ?? []).map((s: string[]) => s.map(authLabel).join(" / ")).join(" + ")}</td></tr>
          ))}</tbody></table>
          <Note noBorder>A higher authority can fill a lower slot (e.g. the MD can approve a Chief-of-Staff-band journal). The preparer never approves their own journal. Projects in the list above come from {Object.keys(projectDetails).length} project(s).</Note>
        </div>
      </div>
    </>
  );
}

/* ================= Bank & cash reconciliation (Finance → Bank & Cash) ================= */
export function BankReconciliation() {
  const { level, toast } = useApp();
  const canEdit = level("finance") >= 2;
  const { accts } = useAccounts();
  const recAccts = accts.filter((a) => a.reconcilable && a.active);
  const [acct, setAcct] = useState("1000");
  const [period, setPeriod] = useState(thisPeriod());
  const [led, setLed] = useState<any>(null);
  const [stmt, setStmt] = useState<any[]>([]);
  const [rec, setRec] = useState<any>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [add, setAdd] = useState({ date: keToday(), description: "", reference: "", amount: "" });
  const load = () => {
    rpc("gl_account_ledger", { p_code: acct, p_from: period, p_to: period }).then(({ data }) => setLed(data));
    supabase.from("gl_statement_lines").select("*").eq("account_code", acct).eq("period", period).order("line_date").then(({ data }) => setStmt(data ?? []));
    supabase.from("gl_reconciliations").select("*").eq("account_code", acct).eq("period", period).maybeSingle().then(({ data }) => {
      setRec(data); setClosing(data ? String(data.statement_balance) : ""); setNotes(data?.notes ?? "");
    });
  };
  useEffect(load, [acct, period]);
  useEffect(() => {
    rpc("gl_trial_balance", { p_from: "0000-01", p_to: thisPeriod() }).then(({ data }) =>
      setBalances(Object.fromEntries(((data?.rows ?? []) as any[]).map((r) => [r.code, Number(r.closing)]))));
  }, []);
  const ledgerEnd = led ? (led.lines.length ? Number(led.lines.at(-1).balance) : Number(led.opening)) : 0;
  const matchedIds = new Set(stmt.map((s) => s.matched_line).filter(Boolean));
  const unmatchedLedger = (led?.lines ?? []).filter((l: any) => !matchedIds.has(l.id));
  const stmtNet = stmt.reduce((s, x) => s + Number(x.amount), 0);
  async function importCsv(file: File) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).map((r) => r.split(",").map((c) => c.replace(/^"|"$/g, "").trim())).filter((r) => r.length >= 2 && r.some(Boolean));
    const body = /date/i.test(rows[0]?.[0] ?? "") ? rows.slice(1) : rows;
    const lines = body.map((r) => {
      // date, description, reference, amount   — or   date, description, amount
      const amt = Number((r.length >= 4 ? r[3] : r[r.length - 1]).replace(/[^\d.\-]/g, ""));
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(r[0]) ? r[0] : (() => { const m = r[0].match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; })();
      return { date: iso, description: r[1] ?? "", reference: r.length >= 4 ? r[2] : "", amount: isNaN(amt) ? null : amt };
    }).filter((l) => l.date && l.amount != null);
    if (!lines.length) { toast("Nothing imported", "Expected columns: date, description, reference, amount (money in +, money out −)"); return; }
    const { data, error } = await rpc("gl_add_statement_lines", { p_account: acct, p_period: period, p_lines: lines });
    if (error) { toast("Import failed", error); return; }
    toast(`${data.added} statement line(s) imported`, ""); load();
  }
  async function addLine() {
    if (!add.date || !Number(add.amount)) { toast("Enter the date and amount", "Money in is +, money out is −"); return; }
    const { error } = await rpc("gl_add_statement_lines", { p_account: acct, p_period: period, p_lines: [{ ...add, amount: Number(add.amount) }] });
    if (error) { toast("Not added", error); return; }
    setAdd({ date: add.date, description: "", reference: "", amount: "" }); load();
  }
  async function match(s: any, lineId: string | null) {
    const { error } = await rpc("gl_match_statement_line", { p_id: s.id, p_line: lineId });
    if (error) { toast("Not matched", error); return; } load();
  }
  async function autoMatch() {
    const { data, error } = await rpc("gl_auto_match", { p_account: acct, p_period: period });
    if (error) { toast("Auto-match failed", error); return; }
    toast(`${data.matched} line(s) matched`, "Same amount, within 5 days"); load();
  }
  async function saveRec() {
    const { data, error } = await rpc("gl_save_reconciliation", { p_account: acct, p_period: period, p_statement_balance: Number(closing), p_notes: notes || null });
    if (error) { toast("Not saved", error); return; }
    toast(data.state === "reconciled" ? `${acct} reconciled for ${periodLabel(period)}` : "Saved with a difference", data.state === "reconciled" ? "Statement agrees with the ledger" : `Difference KES ${money(data.difference)}`); load();
  }
  const acctName = (c: string) => accts.find((a) => a.code === c)?.name ?? c;
  const diff = closing === "" ? null : Math.round((Number(closing) - ledgerEnd) * 100) / 100;
  return (
    <div className="fin-panel active">
      <div className="grid g-3" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(recAccts.length, 1)}, 1fr)`, gap: 12, marginBottom: 16 }}>
        {recAccts.map((a) => (
          <div key={a.code} className="panel" onClick={() => setAcct(a.code)} style={{ cursor: "pointer", outline: acct === a.code ? "2px solid var(--flame)" : undefined }}>
            <div className="pad"><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{a.code} · {a.name}</div><div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>KES {money(balances[a.code] ?? 0)}</div><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>ledger balance today</div></div>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-h"><h3>Reconcile {acct} {acctName(acct)}</h3>
          <span className="meta" style={{ display: "flex", gap: 6, alignItems: "center" }}><PeriodSelect value={period} onChange={setPeriod} n={18} />
            {rec && <span className={`pill ${rec.state === "reconciled" ? "done" : "over"}`}>{rec.state === "reconciled" ? "Reconciled" : `Difference ${money(rec.difference)}`}</span>}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 14 }}>
          <div style={{ minWidth: 0, overflowX: "auto" }}>
            <div className="panel-h"><h3 style={{ fontSize: 13 }}>Statement lines</h3>
              {canEdit && <span className="meta" style={{ display: "flex", gap: 6 }}>
                <label className="btn sm" style={{ cursor: "pointer" }}>Import CSV<input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} /></label>
                <button className="btn sm" onClick={autoMatch} disabled={!stmt.length}>Auto-match</button></span>}
            </div>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Description</th><th style={th}>Amount</th><th>Matched to</th></tr></thead>
              <tbody>
                {!stmt.length && <tr><td colSpan={4} style={{ color: "var(--ink-soft)", textAlign: "center" }}>No statement lines yet — import the {acct === "1010" ? "M-Pesa" : "bank"} statement CSV or add lines.</td></tr>}
                {stmt.map((s) => (
                  <tr key={s.id}><td className="mono" style={{ fontSize: 12 }}>{s.line_date}</td><td style={{ fontSize: 12 }}>{s.description}{s.reference ? <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{s.reference}</div> : null}</td>
                    <td className="mono" style={th}>{signed(Number(s.amount))}</td>
                    <td>{canEdit ? <select className="field" style={{ width: 150, fontSize: 11.5 }} value={s.matched_line ?? ""} onChange={(e) => match(s, e.target.value || null)}>
                      <option value="">— unmatched —</option>
                      {(led?.lines ?? []).filter((l: any) => l.id === s.matched_line || !matchedIds.has(l.id)).map((l: any) => <option key={l.id} value={l.id}>{l.date} {l.ref} {signed(Number(l.debit) - Number(l.credit))}</option>)}
                    </select> : (s.matched_line ? "✓" : "—")}
                      {canEdit && !s.matched_line && <button className="btn" style={{ padding: "2px 6px", fontSize: 11, color: "var(--red)", marginLeft: 4 }} onClick={async () => { const r = await rpc("gl_delete_statement_line", { p_id: s.id }); if (r.error) toast("Not removed", r.error); else load(); }}>×</button>}</td></tr>
                ))}
              </tbody>
            </table>
            {canEdit && <div style={{ display: "flex", gap: 6, padding: "8px 0", alignItems: "center", flexWrap: "wrap" }}>
              <input className="field" type="date" style={{ width: 150 }} value={add.date} onChange={(e) => setAdd({ ...add, date: e.target.value })} />
              <input className="field" style={{ flex: 1, minWidth: 140 }} placeholder="Description / reference" value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })} />
              <input className="field mono" style={{ width: 120 }} type="number" step="0.01" placeholder="+in / −out" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} />
              <button className="btn sm" onClick={addLine}>Add line</button>
            </div>}
          </div>
          <div style={{ minWidth: 0, overflowX: "auto" }}>
            <div className="panel-h"><h3 style={{ fontSize: 13 }}>Ledger entries not on the statement</h3><span className="meta">{unmatchedLedger.length}</span></div>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Journal · memo</th><th style={th}>Amount</th></tr></thead>
              <tbody>
                {!unmatchedLedger.length && <tr><td colSpan={3} style={{ color: "var(--ink-soft)", textAlign: "center" }}>{led?.lines.length ? "Every ledger entry is matched." : "No ledger entries this month."}</td></tr>}
                {unmatchedLedger.map((l: any) => <tr key={l.id}><td className="mono" style={{ fontSize: 12 }}>{l.date}</td><td style={{ fontSize: 12 }}><span className="mono">{l.ref}</span> {l.memo}</td><td className="mono" style={th}>{signed(Number(l.debit) - Number(l.credit))}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="pad">
            <div className="reqbox" style={{ background: "#FCFAF6", borderColor: "transparent", color: "var(--ink)", maxWidth: 560, marginLeft: "auto" }}>
              <div className="recon"><span>Ledger balance at end of {periodLabel(period)}</span><span className="mono">{money(ledgerEnd)}</span></div>
              <div className="recon"><span>Statement lines imported (net)</span><span className="mono">{signed(stmtNet)}</span></div>
              <div className="recon"><span>Statement closing balance</span><input className="field mono" style={{ width: 140, textAlign: "right" }} type="number" step="0.01" disabled={!canEdit} value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
              {diff !== null && <div className="recon" style={{ fontWeight: 700, color: diff ? "var(--red)" : "var(--green, #2F7D4F)" }}><span>{diff ? "Difference" : "Agrees"}</span><span className="mono">{diff ? money(diff) : "✓"}</span></div>}
              {diff ? <div><label>Why is there a difference?</label><input className="field" style={{ width: "100%" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. bank charges not yet posted" /></div> : null}
              {canEdit && <div style={{ marginTop: 8 }}><button className="btn primary" disabled={closing === ""} onClick={saveRec}>Save reconciliation</button></div>}
            </div>
        </div>
        <Note noBorder>Import the statement (CSV: date, description, reference, amount — money in positive, money out negative), match it to the ledger, then enter the statement's closing balance. A month can't close until bank, M-Pesa and petty cash each agree. Missing items (bank charges, interest) go in as a manual journal.</Note>
      </div>
    </div>
  );
}
