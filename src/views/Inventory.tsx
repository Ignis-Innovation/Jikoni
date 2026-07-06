// Inventory & Assets — the one net-new module (PRD Phase 2). Screens reuse the
// existing design system: Pulse, panel/tbl/pill/rcv classes, ModalShell, Crumb.
import { useEffect, useState } from "react";
import { useApp, StockItem } from "../store";
import { Pulse } from "../components/ui";
import { ModalShell } from "../components/modals";
import { PlusI, ExportI } from "../components/icons";
import { kes } from "../data";
import { Crumb } from "../nav";

function ItemStatus({ it }: { it: StockItem }) {
  if (it.onHand < it.reorderLevel)
    return (
      <>
        <span className="rcv no">below reorder</span>
        {it.autoReq && <span className="pill week" style={{ marginLeft: 7 }}>{it.autoReq} raised</span>}
      </>
    );
  return <span className="rcv ok">in stock</span>;
}

function StockModal() {
  const { stockModal, closeStockModal, inventory, receiveStock, issueStock, createDispatch, projectDetails, toast } = useApp();
  const items = inventory?.items ?? [];
  const locations = inventory?.locations ?? [];
  const projects = Object.keys(projectDetails);
  const [sku, setSku] = useState("");
  const [location, setLocation] = useState("");
  const [qtyStr, setQtyStr] = useState("");
  const [reason, setReason] = useState("");
  const [project, setProject] = useState("");
  const [destination, setDestination] = useState("");
  useEffect(() => {
    if (stockModal) {
      setSku(items[0]?.sku || ""); setLocation(locations[0] || ""); setQtyStr("");
      setReason(""); setProject(projects[0] || ""); setDestination("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockModal]);

  const qty = parseFloat(qtyStr) || 0;
  const item = items.find((i) => i.sku === sku);
  const titles = { receive: "Receive stock", issue: "Issue stock", dispatch: "Dispatch to site" } as const;
  const subs = {
    receive: "Posts a receipt movement to the ledger — quantities are never edited directly.",
    issue: "Posts an issue movement; dropping below the reorder level auto-raises a requisition.",
    dispatch: "Issues stock from the central store and links the dispatch to a project.",
  } as const;

  function submit() {
    if (!qty || qty <= 0) { toast("Add a quantity", "Movements need a positive quantity"); return; }
    if (stockModal === "receive") receiveStock(sku, location, qty);
    else if (stockModal === "issue") issueStock(sku, location, qty, reason.trim());
    else if (stockModal === "dispatch") {
      if (!destination.trim()) { toast("Add a destination", "Where is this dispatch going?"); return; }
      createDispatch(project, destination.trim(), sku, qty);
    }
  }

  return (
    <ModalShell open={!!stockModal} onClose={closeStockModal} width={500}>
      <div className="mh">
        <h3>{stockModal ? titles[stockModal] : ""}</h3>
        <p>{stockModal ? subs[stockModal] : ""}</p>
      </div>
      <div className="mb">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Item</label>
            <select className="field" style={{ width: "100%" }} value={sku} onChange={(e) => setSku(e.target.value)}>
              {items.map((i) => <option key={i.sku} value={i.sku}>{i.name} ({i.sku})</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label>Quantity</label>
            <input className="field" type="number" min="0" placeholder="0" style={{ width: "100%" }} value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} />
          </div>
        </div>
        {stockModal !== "dispatch" && (
          <div>
            <label>Location</label>
            <select className="field" style={{ width: "100%" }} value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        )}
        {stockModal === "issue" && (
          <div>
            <label>Reason</label>
            <input className="field" placeholder="e.g. Makueni install batch" style={{ width: "100%" }} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {stockModal === "dispatch" && (
          <>
            <div>
              <label>Project</label>
              <select className="field" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)}>
                {projects.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label>Destination</label>
              <input className="field" placeholder="e.g. Makueni VTC cluster" style={{ width: "100%" }} value={destination} onChange={(e) => setDestination(e.target.value)} />
            </div>
          </>
        )}
        <div className="reqbox" style={{ background: "#FCFAF6", color: item ? "var(--ink)" : "var(--ink-soft)" }}>
          <div className="rl">Stock position</div>
          {item
            ? <>{item.name}: <strong>{item.onHand} {item.unit}</strong> on hand · reorder at {item.reorderLevel}
                {stockModal === "issue" && qty > 0 && item.onHand - qty < item.reorderLevel && !item.autoReq &&
                  <> — this issue drops it below reorder; a requisition will be auto-raised</>}</>
            : "Pick an item."}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeStockModal}>Cancel</button>
        <button className="btn primary" onClick={submit}>
          {stockModal === "receive" ? "Post receipt" : stockModal === "issue" ? "Post issue" : "Dispatch"}
        </button>
      </div>
    </ModalShell>
  );
}

export default function InventoryView() {
  const { tabs, toast, openStockModal, inventory } = useApp();
  const tab = tabs.inventory;
  const items = inventory?.items ?? [];
  const movements = inventory?.movements ?? [];
  const dispatches = inventory?.dispatches ?? [];
  const assets = inventory?.assets ?? [];

  const below = items.filter((i) => i.onHand < i.reorderLevel);
  const stockValue = items.reduce((s, i) => s + i.onHand * i.unitCost, 0);
  const nbv = assets.reduce((s, a) => s + a.nbv, 0);
  const pulse = [
    { k: "Stock items", tick: "t-blue", v: String(items.length), d: "active SKUs", dc: "flat" as const },
    { k: "Stock value", tick: "t-blue", v: kes(stockValue), d: "at cost", dc: "flat" as const },
    { k: "Below reorder", tick: below.length ? "t-red" : "t-green", v: String(below.length), d: below.length ? "auto-req in flight" : "all healthy", dc: "flat" as const },
    { k: "Open dispatches", tick: "t-ember", v: String(dispatches.filter((d) => d.state === "dispatched").length), d: "en route to sites", dc: "flat" as const },
    { k: "Assets (NBV)", tick: "t-blue", v: kes(nbv), d: assets.length + " on register", dc: "flat" as const },
    { k: "Movements", tick: "t-blue", v: String(movements.length), d: "recent ledger entries", dc: "flat" as const },
  ];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Inventory &amp; Assets</h1>
          <p>Stock on a typed movement ledger — receipts, issues, transfers and adjustments are posted, never edited. Below-reorder auto-raises a requisition back into Procurement.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => openStockModal("receive")}>Receive</button>
          <button className="btn" onClick={() => openStockModal("dispatch")}>Dispatch</button>
          <button className="btn primary" onClick={() => openStockModal("issue")}><PlusI />Issue stock</button>
        </div>
      </div>
      <Crumb view="inventory" />

      {tab === "i-over" && (
        <div className="proc-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Needs attention</h3><span className="meta">reorder & receipts</span></div>
              {below.length === 0 && (
                <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  Nothing below reorder level — the loop is quiet.
                </div>
              )}
              {below.map((i) => (
                <div className="task" key={i.sku}>
                  <span className="id" style={{ color: "var(--ember)" }}>{i.sku}</span>
                  <span className="txt">{i.name} — {i.onHand} of {i.reorderLevel} minimum
                    <small>{i.autoReq ? `${i.autoReq} auto-raised — track it in Procurement` : "auto-requisition pending"}</small>
                  </span>
                  <span className="pill over">Low</span>
                </div>
              ))}
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Latest movements</h3><span className="meta">ledger tail</span></div>
              {movements.slice(0, 6).map((m, idx) => (
                <div className="task" key={idx} style={{ cursor: "default" }}>
                  <span className="id">{m.sku}</span>
                  <span className="txt">{m.type}{m.source ? ` · ${m.source}` : ""}{m.note ? ` — ${m.note}` : ""}
                    <small className="mono">{m.when}{m.from ? ` · from ${m.from}` : ""}{m.to ? ` · to ${m.to}` : ""}</small>
                  </span>
                  <span className={`pill ${m.type === "receipt" ? "done" : m.type === "issue" ? "today" : "week"}`}>
                    {m.qty > 0 && m.type !== "adjustment" ? m.qty : m.qty} {m.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "i-items" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Stock items</h3><span className="meta">{items.length} SKUs · valued {kes(stockValue)}</span></div>
            <table className="tbl">
              <thead><tr><th>SKU</th><th>Item</th><th>Category</th><th>On hand</th><th>Reorder at</th><th>Unit cost</th><th>Status</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.sku}>
                    <td className="mono">{i.sku}</td>
                    <td><strong>{i.name}</strong></td>
                    <td style={{ fontSize: 12 }}>{i.category}</td>
                    <td className="mono">{i.onHand} {i.unit}</td>
                    <td className="mono">{i.reorderLevel}</td>
                    <td className="mono">{i.unitCost.toLocaleString()}</td>
                    <td><ItemStatus it={i} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "i-move" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Movement ledger</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); toast("Ledger export", "Full movement history as CSV"); }} style={{ color: "var(--flame)", textDecoration: "none" }}><ExportI width={12} height={12} /> Export</a>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>When</th><th>Item</th><th>Type</th><th>Qty</th><th>From</th><th>To</th><th>Source / note</th></tr></thead>
              <tbody>
                {movements.map((m, idx) => (
                  <tr key={idx}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{m.when}</td>
                    <td className="mono">{m.sku}</td>
                    <td><span className={`pill ${m.type === "receipt" ? "done" : m.type === "issue" ? "today" : "week"}`}>{m.type}</span></td>
                    <td className="mono">{m.qty}</td>
                    <td style={{ fontSize: 12 }}>{m.from || "—"}</td>
                    <td style={{ fontSize: 12 }}>{m.to || "—"}</td>
                    <td style={{ fontSize: 12 }}>{m.source || m.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "i-dsp" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Dispatches</h3><span className="meta">stock issued to projects & sites</span></div>
            {dispatches.length === 0 && (
              <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                No dispatches yet — use Dispatch above to send stock to a site.
              </div>
            )}
            {dispatches.map((d) => (
              <div className="task" key={d.id} style={{ cursor: "default" }}>
                <span className="id">{d.id}</span>
                <span className="txt">{d.destination}{d.project ? ` — ${d.project}` : ""}
                  <small>{d.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}</small>
                </span>
                <span className={`pill ${d.state === "delivered" ? "done" : "today"}`}>{d.state}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "i-assets" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Asset register</h3><span className="meta">straight-line depreciation posts to the GL monthly</span></div>
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Asset</th><th>Category</th><th>Acquired</th><th>Cost</th><th>Accum. dep.</th><th>NBV</th></tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.id}</td>
                    <td><strong>{a.name}</strong></td>
                    <td style={{ fontSize: 12 }}>{a.category}</td>
                    <td style={{ fontSize: 12 }}>{a.acquired}</td>
                    <td className="mono">{a.cost.toLocaleString()}</td>
                    <td className="mono">{a.accumDep.toLocaleString()}</td>
                    <td className="mono"><strong>{a.nbv.toLocaleString()}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StockModal />
    </>
  );
}
