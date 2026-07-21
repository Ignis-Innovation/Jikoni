// Inventory & Assets — the one net-new module (PRD Phase 2). Screens reuse the
// existing design system: Pulse, panel/tbl/pill/rcv classes, ModalShell, Crumb.
import { useEffect, useRef, useState } from "react";
import { useApp, StockItem, DispatchRow } from "../store";
import { Pulse } from "../components/ui";
import { ModalShell } from "../components/modals";
import { PlusI, ExportI, DocI, CheckI } from "../components/icons";
import { kes, budgetLines, kenyaLocations, assetCategories } from "../data";
import { Crumb } from "../nav";
import { supabase } from "../lib/supabase";

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
  const { stockModal, closeStockModal, inventory, receiveStock, issueStock, transferStock, adjustStock, createDispatch, toast } = useApp();
  const items = inventory?.items ?? [];
  const locations = inventory?.locations ?? [];
  const [sku, setSku] = useState("");
  const [location, setLocation] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [qtyStr, setQtyStr] = useState("");
  const [reason, setReason] = useState("");
  const [project, setProject] = useState("");
  const [destination, setDestination] = useState("");
  const [locOpen, setLocOpen] = useState(false);   // dispatch Location typeahead dropdown
  useEffect(() => {
    if (stockModal) {
      setSku(items[0]?.sku || ""); setLocation(locations[0] || ""); setToLoc(locations[1] || locations[0] || "");
      setQtyStr(""); setReason(""); setProject(""); setDestination(""); setLocOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockModal]);

  // Kenyan places whose name starts with what's typed — feeds the custom Location dropdown.
  const locQuery = destination.trim().toLowerCase();
  const locMatches = locQuery ? kenyaLocations.filter((l) => l.toLowerCase().startsWith(locQuery)) : [];

  const qty = parseFloat(qtyStr) || 0;
  const item = items.find((i) => i.sku === sku);
  const titles = {
    receive: "Receive stock", issue: "Issue stock", dispatch: "Dispatch to site",
    transfer: "Transfer between stores", adjust: "Adjust / stock count",
  } as const;
  const subs = {
    receive: "Posts a receipt movement to the ledger — quantities are never edited directly.",
    issue: "Posts an issue movement; dropping below the reorder level auto-raises a requisition.",
    dispatch: "Issues stock from the central store and links the dispatch to a project.",
    transfer: "Moves stock between locations — posts a transfer movement. Totals are unchanged.",
    adjust: "Sets the counted quantity at a location; the difference posts as an adjustment. Needs full inventory access.",
  } as const;
  const btnLabel = {
    receive: "Post receipt", issue: "Post issue", dispatch: "Dispatch",
    transfer: "Post transfer", adjust: "Post adjustment",
  } as const;
  // "adjust" is the only mode where 0 is a legitimate quantity (counted to empty)
  const qtyLabel = stockModal === "adjust" ? "Counted qty" : "Quantity";

  function submit() {
    if (stockModal === "adjust") {
      if (qtyStr.trim() === "" || qty < 0) { toast("Add a counted quantity", "Enter the quantity you counted (0 or more)"); return; }
      adjustStock(sku, location, qty, reason.trim());
      return;
    }
    if (!qty || qty <= 0) { toast("Add a quantity", "Movements need a positive quantity"); return; }
    if (stockModal === "receive") receiveStock(sku, location, qty);
    else if (stockModal === "issue") issueStock(sku, location, qty, reason.trim());
    else if (stockModal === "transfer") {
      if (location === toLoc) { toast("Pick two locations", "From and To must be different"); return; }
      transferStock(sku, location, toLoc, qty);
    } else if (stockModal === "dispatch") {
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
            <label>{qtyLabel}</label>
            <input className="field" type="number" min="0" placeholder="0" style={{ width: "100%" }} value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} />
          </div>
        </div>
        {stockModal !== "dispatch" && (
          <div>
            <label>{stockModal === "transfer" ? "From location" : "Location"}</label>
            <select className="field" style={{ width: "100%" }} value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        )}
        {stockModal === "transfer" && (
          <div>
            <label>To location</label>
            <select className="field" style={{ width: "100%" }} value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        )}
        {(stockModal === "issue" || stockModal === "adjust") && (
          <div>
            <label>Reason</label>
            <input className="field" placeholder={stockModal === "adjust" ? "e.g. quarterly stock count" : "e.g. Makueni install batch"} style={{ width: "100%" }} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {stockModal === "dispatch" && (
          <>
            <div>
              <label>Project</label>
              <input className="field" placeholder="Project name" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)} />
            </div>
            <div style={{ position: "relative" }}>
              <label>Location</label>
              <input
                className="field" style={{ width: "100%" }} autoComplete="off"
                placeholder="Start typing a county — e.g. Murang'a, Kakamega"
                value={destination}
                onChange={(e) => { setDestination(e.target.value); setLocOpen(true); }}
                onFocus={() => setLocOpen(true)}
                onBlur={() => setTimeout(() => setLocOpen(false), 120)}
              />
              {locOpen && locMatches.length > 0 && (
                <div className="ac-menu">
                  {locMatches.map((l) => (
                    <div
                      key={l} className="ac-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setDestination(l); setLocOpen(false); }}
                    >{l}</div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <div className="reqbox" style={{ background: "#FCFAF6", color: item ? "var(--ink)" : "var(--ink-soft)" }}>
          <div className="rl">Stock position</div>
          {item
            ? <>{item.name}: <strong>{item.onHand} {item.unit}</strong> on hand · reorder at {item.reorderLevel}
                {stockModal === "issue" && qty > 0 && item.onHand - qty < item.reorderLevel && !item.autoReq &&
                  <> — this issue drops it below reorder; a requisition will be auto-raised</>}
                {stockModal === "adjust" && qtyStr.trim() !== "" &&
                  <> — counted {qty}: a {qty - item.onHand >= 0 ? "+" : ""}{qty - item.onHand} adjustment will post</>}</>
            : "Pick an item."}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeStockModal}>Cancel</button>
        <button className="btn primary" onClick={submit}>{stockModal ? btnLabel[stockModal] : ""}</button>
      </div>
    </ModalShell>
  );
}

// Create a stock item (SKU auto-generated) or edit an existing one's reorder policy / cost.
function ItemModal() {
  const { itemModal, closeItemModal, createStockItem, updateStockItem, toast } = useApp();
  const editing = itemModal && itemModal !== "new" ? itemModal : null;
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("unit");
  const [unitCost, setUnitCost] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [reorderQty, setReorderQty] = useState("");
  const [budgetCode, setBudgetCode] = useState("");
  useEffect(() => {
    if (!itemModal) return;
    if (editing) {
      setName(editing.name); setCategory(editing.category || ""); setUnit(editing.unit || "unit");
      setUnitCost(String(editing.unitCost)); setReorderLevel(String(editing.reorderLevel)); setReorderQty(""); setBudgetCode("");
    } else {
      setName(""); setCategory(""); setUnit("unit"); setUnitCost(""); setReorderLevel(""); setReorderQty(""); setBudgetCode("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemModal]);

  function submit() {
    const cost = parseFloat(unitCost) || 0;
    const rl = parseFloat(reorderLevel) || 0;
    const rq = parseFloat(reorderQty) || 0;
    if (editing) { updateStockItem(editing.sku, rl, rq, cost); return; }
    if (!name.trim()) { toast("Name is required", "Give the item a name — a code is assigned automatically"); return; }
    createStockItem({ name: name.trim(), category: category.trim(), unit: unit.trim() || "unit", unitCost: cost, reorderLevel: rl, reorderQty: rq, budgetCode });
  }

  return (
    <ModalShell open={!!itemModal} onClose={closeItemModal} width={520}>
      <div className="mh">
        <h3>{editing ? `Edit ${editing.sku}` : "Add stock item"}</h3>
        <p>{editing ? "Adjust the reorder policy and unit cost. Balances only change via posted movements." : "Registers a new item with an auto-assigned code. Its balance opens at zero — receive stock to add quantity."}</p>
      </div>
      <div className="mb">
        {!editing && (
          <>
            <div>
              <label>Name</label>
              <input className="field" placeholder="Institutional cooker — 60L" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="mrow c2">
              <div>
                <label>Category</label>
                <input className="field" placeholder="Cookstoves" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div>
                <label>Unit</label>
                <input className="field" placeholder="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
          </>
        )}
        <div className="mrow c3">
          <div>
            <label>Unit cost (KES)</label>
            <input className="field" type="number" min="0" placeholder="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
          <div>
            <label>Reorder at</label>
            <input className="field" type="number" min="0" placeholder="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
          </div>
          <div>
            <label>Reorder qty</label>
            <input className="field" type="number" min="0" placeholder="0" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} />
          </div>
        </div>
        {!editing && (
          <div>
            <label>Budget code (for auto-requisitions)</label>
            <select className="field" value={budgetCode} onChange={(e) => setBudgetCode(e.target.value)}>
              <option value="">— none —</option>
              {Object.keys(budgetLines).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="mf">
        <button className="btn" onClick={closeItemModal}>Cancel</button>
        <button className="btn primary" onClick={submit}>{editing ? "Save changes" : "Add item"}</button>
      </div>
    </ModalShell>
  );
}

// Register a fixed asset for the depreciation register.
function AssetModal() {
  const { assetOpen, closeAssetForm, registerAsset, toast } = useApp();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [cost, setCost] = useState("");
  const [lifeMonths, setLifeMonths] = useState("");
  const [salvage, setSalvage] = useState("");
  const [acquired, setAcquired] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => {
    if (assetOpen) { setName(""); setCategory(""); setCost(""); setLifeMonths(""); setSalvage(""); setAcquired(new Date().toISOString().slice(0, 10)); }
  }, [assetOpen]);

  function submit() {
    const c = parseFloat(cost) || 0;
    const life = parseInt(lifeMonths, 10) || 0;
    if (!name.trim()) { toast("Add a name", "Name the asset"); return; }
    if (c <= 0) { toast("Add a cost", "Cost must be greater than zero"); return; }
    if (life <= 0) { toast("Add a useful life", "Life in months must be greater than zero"); return; }
    registerAsset({ name: name.trim(), category: category.trim(), cost: c, lifeMonths: life, acquired, salvage: parseFloat(salvage) || 0 });
  }

  return (
    <ModalShell open={assetOpen} onClose={closeAssetForm} width={520}>
      <div className="mh">
        <h3>Register asset</h3>
        <p>Adds the asset to the register. Straight-line depreciation posts to the GL when you run the monthly depreciation.</p>
      </div>
      <div className="mb">
        <div>
          <label>Name</label>
          <input className="field" placeholder="Toyota Hilux — field vehicle" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="mrow c2">
          <div>
            <label>Category</label>
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— select —</option>
              {assetCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Acquired on</label>
            <input className="field" type="date" value={acquired} onChange={(e) => setAcquired(e.target.value)} />
          </div>
        </div>
        <div className="mrow c3">
          <div>
            <label>Cost (KES)</label>
            <input className="field" type="number" min="0" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div>
            <label>Salvage (KES)</label>
            <input className="field" type="number" min="0" placeholder="0" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
          </div>
          <div>
            <label>Life (months)</label>
            <input className="field" type="number" min="1" placeholder="60" value={lifeMonths} onChange={(e) => setLifeMonths(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeAssetForm}>Cancel</button>
        <button className="btn primary" onClick={submit}>Register</button>
      </div>
    </ModalShell>
  );
}

// Full movement history → CSV download (RLS allows read for authenticated).
async function exportMovements(toast: (t: string, s?: string) => void) {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("created_at, movement_type, qty, unit_cost, source_type, source_ref, note, item:stock_items!inner(sku,name), fl:stock_locations!stock_movements_from_location_fkey(name), tl:stock_locations!stock_movements_to_location_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) { toast("Export failed", error.message); return; }
  const rows = (data as any[]) ?? [];
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ["When", "SKU", "Item", "Type", "Qty", "Unit cost", "From", "To", "Source", "Ref", "Note"];
  const lines = rows.map((r) => [
    r.created_at, r.item?.sku, r.item?.name, r.movement_type, r.qty, r.unit_cost,
    r.fl?.name, r.tl?.name, r.source_type, r.source_ref, r.note,
  ].map(esc).join(","));
  const csv = [header.join(","), ...lines].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast("Movement history exported", `${rows.length} rows as CSV`);
}

// One dispatch row. Delivered dispatches can carry a proof-of-delivery receipt:
// click "Add receipt" → pick a file → it uploads to Storage and saves against the dispatch.
function DispatchItem({ d }: { d: DispatchRow }) {
  const { setDispatchState, attachDispatchReceipt, receiptUrl } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="task" style={{ cursor: "default" }}>
      <span className="id">{d.id}</span>
      <span className="txt">{d.destination}{d.project ? ` — ${d.project}` : ""}
        <small>{d.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}</small>
      </span>
      {d.state === "dispatched" && (
        <button className="btn" style={{ marginRight: 8 }} onClick={() => setDispatchState(d.id, "delivered")}>Mark delivered</button>
      )}
      {d.state === "delivered" && (
        <>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attachDispatchReceipt(d.id, f); e.target.value = ""; }} />
          {d.receipt ? (
            <a href={receiptUrl(d.receipt)} target="_blank" rel="noopener noreferrer" className="btn"
              style={{ marginRight: 8, display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none", color: "var(--green)" }} title="View delivery receipt">
              <CheckI width={13} height={13} /> Receipt
            </a>
          ) : (
            <button className="btn" style={{ marginRight: 8, display: "inline-flex", alignItems: "center", gap: 5 }}
              onClick={() => fileRef.current?.click()} title="Upload a proof-of-delivery receipt">
              <DocI width={13} height={13} /> Add receipt
            </button>
          )}
        </>
      )}
      <span className={`pill ${d.state === "delivered" ? "done" : d.state === "cancelled" ? "over" : "today"}`}>{d.state}</span>
    </div>
  );
}

export default function InventoryView() {
  const { tabs, toast, openStockModal, inventory, openItemModal, openAssetForm, disposeAsset } = useApp();
  const tab = tabs.inventory;
  const items = inventory?.items ?? [];
  const movements = inventory?.movements ?? [];
  const dispatches = inventory?.dispatches ?? [];
  const assets = inventory?.assets ?? [];

  const below = items.filter((i) => i.onHand < i.reorderLevel);
  const enRoute = dispatches.filter((d) => d.state === "dispatched");
  const awaitingReceipt = dispatches.filter((d) => d.state === "delivered" && !d.receipt);
  const attentionCount = below.length + enRoute.length + awaitingReceipt.length;
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
          {/* Stock quick actions live only on the Overview tab; other tabs show their own panel buttons. */}
          {tab === "i-over" && (
            <>
              <button className="btn" onClick={() => openStockModal("receive")}>Receive stock</button>
              <button className="btn" onClick={() => openStockModal("transfer")}>Transfer stock</button>
              <button className="btn" onClick={() => openStockModal("adjust")}>Adjust count</button>
              <button className="btn" onClick={() => openStockModal("dispatch")}>Dispatch item</button>
            </>
          )}
          {/* The Dispatches tab's primary action dispatches stock to a site — its Destination
              field carries the Kenyan-location typeahead (type "mu" → Murang'a, Makueni…). */}
          {tab === "i-dsp" && (
            <button className="btn primary" onClick={() => openStockModal("dispatch")}><PlusI />Dispatch stock</button>
          )}
        </div>
      </div>
      <Crumb view="inventory" />

      {tab === "i-over" && (
        <div className="proc-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Needs attention</h3><span className="meta">reorder · dispatches · receipts</span></div>
              {attentionCount === 0 && (
                <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  All clear — nothing below reorder, no dispatches in flight, every delivery has a receipt.
                </div>
              )}
              {below.map((i) => (
                <div className="task" key={i.sku}>
                  <span className="id" style={{ color: "var(--ember)" }}>{i.sku}</span>
                  <span className="txt">{i.name} — {i.onHand} of {i.reorderLevel} minimum
                    <small>{i.autoReq ? `${i.autoReq} auto-raised — track it in Procurement` : "auto-requisition pending"}</small>
                  </span>
                  <span className="pill over">{i.onHand <= 0 ? "Out of stock" : "Low"}</span>
                </div>
              ))}
              {enRoute.map((d) => (
                <div className="task" key={d.id} style={{ cursor: "default" }}>
                  <span className="id">{d.id}</span>
                  <span className="txt">En route to {d.destination}{d.project ? ` — ${d.project}` : ""}
                    <small>{d.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")} — confirm delivery on the Dispatches tab</small>
                  </span>
                  <span className="pill today">En route</span>
                </div>
              ))}
              {awaitingReceipt.map((d) => (
                <div className="task" key={d.id} style={{ cursor: "default" }}>
                  <span className="id">{d.id}</span>
                  <span className="txt">{d.destination} delivered — no receipt attached
                    <small>Upload the proof-of-delivery on the Dispatches tab</small>
                  </span>
                  <span className="pill week">Receipt due</span>
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
            <div className="panel-h">
              <h3>Stock items</h3>
              <span className="meta" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {items.length} SKUs · valued {kes(stockValue)}
                <button className="btn" onClick={() => openItemModal("new")}><PlusI width={13} height={13} /> Add stock item</button>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>SKU</th><th>Item</th><th>Category</th><th>On hand</th><th>Reorder at</th><th>Unit cost</th><th>Status</th><th></th></tr></thead>
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
                    <td style={{ textAlign: "right" }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); openItemModal(i); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12 }}>Edit</a>
                    </td>
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
                <a href="#" onClick={(e) => { e.preventDefault(); exportMovements(toast); }} style={{ color: "var(--flame)", textDecoration: "none" }}><ExportI width={12} height={12} /> Export CSV</a>
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
            {dispatches.map((d) => <DispatchItem key={d.id} d={d} />)}
          </div>
        </div>
      )}

      {tab === "i-assets" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Asset register</h3>
              <span className="meta" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                straight-line depreciation posts to the GL monthly
                <button className="btn" onClick={openAssetForm}><PlusI width={13} height={13} /> Register asset</button>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Asset</th><th>Category</th><th>Acquired</th><th>Cost</th><th>Accum. dep.</th><th>NBV</th><th></th></tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} style={{ opacity: a.state === "disposed" ? 0.55 : 1 }}>
                    <td className="mono">{a.id}</td>
                    <td><strong>{a.name}</strong>{a.state === "disposed" && <span className="pill over" style={{ marginLeft: 7 }}>disposed</span>}</td>
                    <td style={{ fontSize: 12 }}>{a.category}</td>
                    <td style={{ fontSize: 12 }}>{a.acquired}</td>
                    <td className="mono">{a.cost.toLocaleString()}</td>
                    <td className="mono">{a.accumDep.toLocaleString()}</td>
                    <td className="mono"><strong>{a.nbv.toLocaleString()}</strong></td>
                    <td style={{ textAlign: "right" }}>
                      {a.state !== "disposed" && (
                        <a href="#" onClick={(e) => { e.preventDefault(); const reason = window.prompt(`Dispose ${a.name}? Optional reason:`, ""); if (reason !== null) disposeAsset(a.id, reason); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12 }}>Dispose</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StockModal />
      <ItemModal />
      <AssetModal />
    </>
  );
}
