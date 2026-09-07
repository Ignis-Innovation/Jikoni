// IRENA – Taita Taveta programme workspace. Overview of the A2CT baseline (static
// survey figures, ECharts), a Budget tab (allocations with add/edit/delete + a
// breakdown graph) and an Institutions tab (category cards → institution list).
// Rendered as the "IRENA" sub-tab of Projects & Programmes. ECharts + this whole
// view are lazy-loaded, so they only load when the tab is opened.
import { lazy, Suspense, useState, useEffect } from "react";
import { useApp } from "../store";
import { isGlobalEditor, type ProjectMember } from "../data";
import { Note, ViewOnly } from "../components/ui";
import { ModalShell } from "../components/modals";
import {
  DATASET_GROUPS, ENERGY_BY_CATEGORY, GEO_DISTRIBUTION, FUEL_MIX_BY_CATEGORY,
  ELECTRICITY_ACCESS_BY_CATEGORY, BASELINE_META, ENERGY_SHORT, matchesIrena,
} from "../lib/baseline";
import { INSTITUTION_GROUPS } from "../lib/institutions";

const ReactECharts = lazy(() => import("echarts-for-react"));
function Chart(props: { option: unknown; style?: React.CSSProperties }) {
  return (
    <Suspense fallback={<div style={{ height: (props.style?.height as number) ?? 300, display: "grid", placeItems: "center", color: "var(--ink-faint)", fontSize: 13 }}>Loading chart…</div>}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ReactECharts option={props.option as any} style={props.style} notMerge lazyUpdate />
    </Suspense>
  );
}

const fmtKes = (n: number) => "KES " + Math.round(n || 0).toLocaleString();

/* ---------- chart option builders (ported from clean-cook-iq) ---------- */
const BAR_COLORS: [string, string][] = [
  ["#60a5fa", "#2563eb"], ["#38bdf8", "#0ea5e9"], ["#2dd4bf", "#0d9488"],
  ["#4ade80", "#16a34a"], ["#a3e635", "#65a30d"], ["#fbbf24", "#d97706"],
];
const PIE_COLORS = ["#12A3BE", "#2563eb", "#0d9488", "#16a34a", "#f59e0b", "#94a3b8", "#a855f7", "#ef4444"];
const FUEL_MIX_COLORS = { firewood: "#a16207", charcoal: "#334155", lpg: "#12A3BE", other: "#94a3b8" };

function categoryBarOption(items: { name: string; value: number }[], opts: { unit: string; valueFmt?: (v: number) => string }) {
  const fmt = opts.valueFmt ?? ((v: number) => Number(v).toLocaleString());
  return {
    grid: { top: 36, right: 12, bottom: 24, left: 36, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(20,40,30,.92)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 }, formatter: (p: { name: string; value: number }[]) => `${p[0].name}<br/><b>${fmt(p[0].value)}</b> ${opts.unit}` },
    xAxis: { type: "category", data: items.map((i) => i.name), axisTick: { show: false }, axisLine: { lineStyle: { color: "#cbd5e1" } }, axisLabel: { fontSize: 11, color: "#68707B" } },
    yAxis: { type: "value", splitLine: { lineStyle: { type: "dashed", color: "#EBEDF0" } }, axisLabel: { show: false } },
    series: [{
      type: "bar", barWidth: "52%",
      data: items.map((i, idx) => { const [top, bottom] = BAR_COLORS[idx % BAR_COLORS.length]; return { value: i.value, itemStyle: { borderRadius: [6, 6, 0, 0], color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }] } } }; }),
      label: { show: true, position: "top", fontSize: 11, fontWeight: "bold", color: "#22262E", formatter: (p: { value: number }) => fmt(p.value) },
    }],
  };
}

function sharePieOption(items: { name: string; value: number }[], unit: string) {
  return {
    color: PIE_COLORS,
    tooltip: { trigger: "item", backgroundColor: "rgba(20,40,30,.92)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 }, formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/><b>${Number(p.value).toLocaleString()}</b> ${unit} (${p.percent}%)` },
    legend: { top: 0, left: "center", icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11, color: "#68707B" } },
    series: [{ type: "pie", radius: ["42%", "68%"], center: ["50%", "58%"], avoidLabelOverlap: true, itemStyle: { borderColor: "#fff", borderWidth: 2 }, label: { show: true, position: "outside", lineHeight: 15, formatter: "{b}\n{d}%", fontSize: 11, fontWeight: "bold", color: "#22262E" }, labelLine: { show: true, length: 10, length2: 8 }, data: items }],
  };
}

function stackedBarOption(categories: string[], series: { name: string; color: string; data: number[] }[]) {
  return {
    grid: { top: 40, right: 12, bottom: 24, left: 36, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(20,40,30,.92)", borderColor: "transparent", textStyle: { color: "#fff", fontSize: 12 }, valueFormatter: (v: number) => `${Number(v).toFixed(1)}%` },
    legend: { top: 0, left: "center", icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11, color: "#68707B" } },
    xAxis: { type: "category", data: categories, axisTick: { show: false }, axisLine: { lineStyle: { color: "#cbd5e1" } }, axisLabel: { fontSize: 11, color: "#68707B" } },
    yAxis: { type: "value", max: 100, splitLine: { lineStyle: { type: "dashed", color: "#EBEDF0" } }, axisLabel: { fontSize: 11, color: "#9AA2AD", formatter: "{value}%" } },
    series: series.map((s, i) => ({ name: s.name, type: "bar", stack: "fuel", barWidth: "52%", data: s.data, itemStyle: { color: s.color, borderRadius: i === series.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0] } })),
  };
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat"><div className="k">{k}</div><div className="v">{v}</div></div>;
}

type BudgetItem = { id: string; name: string; description?: string | null; amount: number; addedBy?: string | null };

export default function IrenaView() {
  const { projectDetails, me, addBudgetItem, updateBudgetItem, removeBudgetItem, listProjectMembers, setProjectMemberRole } = useApp();
  const [sub, setSub] = useState<"overview" | "budget" | "institutions" | "members">("overview");
  const [members, setMembers] = useState<ProjectMember[]>([]);

  const entry = Object.entries(projectDetails).find(([name]) => matchesIrena(name));
  const projId = entry?.[1].id ?? "";

  // IRENA-scoped rights: global editors always; otherwise an 'editor' member of
  // this project (delegated by HR). Members are also used to drive the Members tab.
  useEffect(() => {
    if (!projId) return;
    let live = true;
    listProjectMembers(projId).then((m) => { if (live) setMembers(m); });
    return () => { live = false; };
  }, [projId, listProjectMembers]);

  const amGlobalEditor = isGlobalEditor(me?.email);
  const myRole = members.find((m) => m.email.toLowerCase() === (me?.email ?? "").toLowerCase())?.role;
  const canEdit = amGlobalEditor || myRole === "editor";

  if (!entry) {
    return <div className="proj-panel active"><Note>The IRENA – Taita Taveta project isn't loaded yet. Reload the page — it's seeded in the database.</Note></div>;
  }
  const [projName, proj] = entry;
  const budgetItems = (proj.budgetItems ?? []) as BudgetItem[];
  const allocated = budgetItems.reduce((s, b) => s + (b.amount || 0), 0) || (proj.budgetAmount ?? 0);

  const energyFuel = ENERGY_BY_CATEGORY.map((e) => ({ name: ENERGY_SHORT[e.category] ?? e.category, value: e.fuelTonnes }));
  const energyElec = ENERGY_BY_CATEGORY.map((e) => ({ name: ENERGY_SHORT[e.category] ?? e.category, value: e.elecKwh }));
  const geoData = GEO_DISTRIBUTION.map((g) => ({ name: g.subCounty, value: g.records }));
  const elecAccess = ELECTRICITY_ACCESS_BY_CATEGORY.map((e) => ({ name: ENERGY_SHORT[e.category] ?? e.category, value: e.accessPct }));
  const fuelMixCats = FUEL_MIX_BY_CATEGORY.map((f) => ENERGY_SHORT[f.category] ?? f.category);
  const fuelMixSeries = [
    { name: "Firewood", color: FUEL_MIX_COLORS.firewood, data: FUEL_MIX_BY_CATEGORY.map((f) => f.firewood) },
    { name: "Charcoal", color: FUEL_MIX_COLORS.charcoal, data: FUEL_MIX_BY_CATEGORY.map((f) => f.charcoal) },
    { name: "LPG", color: FUEL_MIX_COLORS.lpg, data: FUEL_MIX_BY_CATEGORY.map((f) => f.lpg) },
    { name: "Other", color: FUEL_MIX_COLORS.other, data: FUEL_MIX_BY_CATEGORY.map((f) => f.other) },
  ];

  return (
    <div className="proj-panel active">
      <ViewOnly show={!canEdit} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", letterSpacing: "-.5px" }}>{BASELINE_META.title}</h2>
          <div className="meta" style={{ marginTop: 3 }}>{BASELINE_META.subtitle}</div>
        </div>
        <span className="meta">{BASELINE_META.reference}</span>
      </div>

      <div className="subtabs" style={{ marginTop: 14 }}>
        {([["overview", "Overview"], ["budget", "Budget"], ["institutions", "Institutions"], ...(canEdit ? [["members", "Members"] as const] : [])] as const).map(([k, l]) => (
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>

      {sub === "overview" && (
        <>
          <p className="meta" style={{ maxWidth: 720, marginBottom: 14 }}>
            Baseline figures are drawn from the survey of {BASELINE_META.totalRecords.toLocaleString()} institutions across {BASELINE_META.subCounties} ({BASELINE_META.period}).
          </p>
          <div className="pulse" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            <Stat k="Institutions surveyed" v={BASELINE_META.totalRecords.toLocaleString()} />
            <Stat k="Budget allocated" v={fmtKes(allocated)} />
            <Stat k="Categories" v={String(DATASET_GROUPS.length)} />
            <Stat k="Sub-counties" v="4" />
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Estimated annual energy consumption</h3><span className="meta">derived from the A2CT baseline — per category</span></div>
            <div className="grid g-2" style={{ padding: 14 }}>
              <div><div className="meta" style={{ marginBottom: 4 }}>Cooking fuel — tonnes / year</div><Chart style={{ height: 250 }} option={categoryBarOption(energyFuel, { unit: "tonnes / yr", valueFmt: (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) })} /></div>
              <div><div className="meta" style={{ marginBottom: 4 }}>Electricity — kWh / year</div><Chart style={{ height: 250 }} option={categoryBarOption(energyElec, { unit: "kWh / yr", valueFmt: (v) => `${(v / 1000).toFixed(0)}k` })} /></div>
            </div>
          </div>

          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel"><div className="panel-h"><h3>Geographic distribution</h3><span className="meta">by sub-county</span></div><div style={{ padding: 14 }}><Chart style={{ height: 300 }} option={sharePieOption(geoData, "records")} /></div></div>
            <div className="panel"><div className="panel-h"><h3>Electricity access</h3><span className="meta">% of each category on the grid</span></div><div style={{ padding: 14 }}><Chart style={{ height: 300 }} option={categoryBarOption(elecAccess, { unit: "electrified", valueFmt: (v) => `${v.toFixed(0)}%` })} /></div></div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Primary fuel mix by category</h3><span className="meta">share of each fuel within a category</span></div>
            <div style={{ padding: 14 }}><Chart style={{ height: 320 }} option={stackedBarOption(fuelMixCats, fuelMixSeries)} /></div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Surveyed datasets</h3><span className="meta">{DATASET_GROUPS.length} categories · {BASELINE_META.totalRecords} records</span></div>
            <table className="tbl">
              <thead><tr><th>Category</th><th style={{ textAlign: "right" }}>Records</th><th>Primary fuel</th><th>Electricity</th><th>Key population</th></tr></thead>
              <tbody>
                {DATASET_GROUPS.map((g) => (
                  <tr key={g.key}><td>{g.title}</td><td style={{ textAlign: "right" }} className="mono">{g.records}</td><td>{g.primaryFuel}</td><td>{g.electricityAccess}</td><td className="meta">{g.keyPopulation}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sub === "budget" && (
        <BudgetTab projId={projId} projName={projName} items={budgetItems} allocated={allocated} canEdit={canEdit}
          onAdd={addBudgetItem} onUpdate={updateBudgetItem} onRemove={removeBudgetItem} />
      )}

      {sub === "institutions" && <InstitutionsTab />}

      {sub === "members" && canEdit && (
        <MembersTab members={members} canManage={amGlobalEditor}
          onSet={async (email, role) => { const next = await setProjectMemberRole(projId, email, role); if (next) setMembers(next); }} />
      )}
    </div>
  );
}

/* ---------- Members tab: per-project access (HR-managed) ---------- */
function MembersTab({ members, canManage, onSet }: {
  members: ProjectMember[]; canManage: boolean;
  onSet: (email: string, role: "viewer" | "editor") => void;
}) {
  const editors = members.filter((m) => m.role === "editor").length;
  return (
    <div className="panel">
      <div className="panel-h"><h3>Project access</h3><span className="meta">{members.length} people · {editors} can edit</span></div>
      <Note>
        Everyone can view IRENA. {canManage
          ? "As an administrator you can grant a person edit access to this project only — it doesn't affect any other module."
          : "Access is managed by HR — this is a read-only view."}
      </Note>
      <table className="tbl">
        <thead><tr><th>Person</th><th>IRENA access</th>{canManage && <th style={{ textAlign: "right" }}>Change</th>}</tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.email}>
              <td>
                <div className="who">
                  <div className="av-sm" style={{ background: "#D8D2C7" }}>{m.name[0]}</div>
                  <div><div className="nm">{m.name}</div><div className="em">{m.email}</div></div>
                </div>
              </td>
              <td><span className={`pill ${m.role === "editor" ? "done" : "week"}`} style={{ textTransform: "none" }}>{m.role === "editor" ? "Can edit" : "View only"}</span></td>
              {canManage && (
                <td style={{ textAlign: "right" }}>
                  {m.locked ? <span className="meta">fixed</span> : (
                    <select className="field" style={{ padding: "5px 9px", width: "auto" }} value={m.role} onChange={(e) => onSet(m.email, e.target.value as "viewer" | "editor")}>
                      <option value="viewer">View only</option>
                      <option value="editor">Can edit</option>
                    </select>
                  )}
                </td>
              )}
            </tr>
          ))}
          {!members.length && <tr><td colSpan={canManage ? 3 : 2}><Note>No members to show.</Note></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Budget tab: button-reveal add/edit modal + breakdown graph ---------- */
function BudgetTab({ projId, projName, items, allocated, canEdit, onAdd, onUpdate, onRemove }: {
  projId: string; projName: string; allocated: number; canEdit: boolean; items: BudgetItem[];
  onAdd: (projectId: string, name: string, description: string, amount: number) => void;
  onUpdate: (itemId: string, name: string, description: string, amount: number) => void;
  onRemove: (itemId: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmDel, setConfirmDel] = useState<BudgetItem | null>(null);

  function openAdd() { setEditing(null); setName(""); setDesc(""); setAmount(""); setFormOpen(true); }
  function openEdit(b: BudgetItem) { setEditing(b); setName(b.name); setDesc(b.description ?? ""); setAmount(String(b.amount)); setFormOpen(true); }
  function save() {
    if (!name.trim() || !amount) return;
    if (editing) onUpdate(editing.id, name.trim(), desc.trim(), Number(amount));
    else onAdd(projId, name.trim(), desc.trim(), Number(amount));
    setFormOpen(false);
  }

  const pie = items.map((b) => ({ name: b.name, value: b.amount }));

  return (
    <>
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h">
            <h3>Budget allocations</h3>
            {canEdit && <button className="btn primary" style={{ padding: "6px 12px" }} onClick={openAdd}>+ Add budget item</button>}
          </div>
          <div className="pad">
            <div className="recon"><span>Total allocated</span><span className="mono">{fmtKes(allocated)}</span></div>
            <div className="recon"><span>Budget lines</span><span className="mono">{items.length}</span></div>
            <div className="meta" style={{ marginTop: 8 }}>Project: {projName}</div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Allocation breakdown</h3><span className="meta">share by budget line</span></div>
          <div style={{ padding: 14 }}>
            {pie.length ? <Chart style={{ height: 260 }} option={sharePieOption(pie, "KES")} /> : <Note>No budget items yet{canEdit ? " — add the first allocation." : "."}</Note>}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h"><h3>Budget lines</h3><span className="meta">{items.length} item{items.length === 1 ? "" : "s"}</span></div>
        <table className="tbl">
          <thead><tr><th>Item</th><th>Description</th><th>Added by</th><th style={{ textAlign: "right" }}>Amount</th>{canEdit && <th style={{ textAlign: "right" }}>Actions</th>}</tr></thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td className="meta">{b.description || "—"}</td>
                <td className="meta">{b.addedBy || "—"}</td>
                <td style={{ textAlign: "right" }} className="mono">{fmtKes(b.amount)}</td>
                {canEdit && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ padding: "3px 9px", fontSize: 11.5 }} onClick={() => openEdit(b)}>Edit</button>{" "}
                    <button className="btn" style={{ padding: "3px 9px", fontSize: 11.5, color: "var(--red)" }} onClick={() => setConfirmDel(b)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {!items.length && <tr><td colSpan={canEdit ? 5 : 4}><Note>No budget items yet.{canEdit ? " Use “Add budget item”." : ""}</Note></td></tr>}
          </tbody>
        </table>
      </div>

      {/* add / edit modal */}
      <ModalShell open={formOpen} onClose={() => setFormOpen(false)} width={460}>
        <div className="mh"><h3>{editing ? "Edit budget item" : "Add budget item"}</h3><p>{editing ? "Update this allocation." : "Add a planned allocation to the IRENA budget."}</p></div>
        <div className="mb">
          <div><label>Item</label><input className="field" placeholder="e.g. LPG cylinders x40" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>Description <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" placeholder="What this budget line covers" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div><label>Amount (KES)</label><input className="field" type="number" min="0" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></div>
        </div>
        <div className="mf">
          <button className="btn" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn primary" onClick={save}>{editing ? "Save changes" : "Add item"}</button>
        </div>
      </ModalShell>

      {/* delete confirm */}
      <ModalShell open={!!confirmDel} onClose={() => setConfirmDel(null)} width={440}>
        <div className="mh"><h3>Delete budget item?</h3><p>You're about to delete <strong>{confirmDel?.name}</strong>.</p></div>
        <div className="mb"><Note noBorder>This removes the allocation from the IRENA budget. This can't be undone.</Note></div>
        <div className="mf">
          <button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn" style={{ color: "var(--red)" }} onClick={() => { if (confirmDel) onRemove(confirmDel.id); setConfirmDel(null); }}>Delete item</button>
        </div>
      </ModalShell>
    </>
  );
}

/* ---------- Institutions tab: category cards → list ---------- */
function InstitutionsTab() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const group = INSTITUTION_GROUPS.find((g) => g.key === openKey);

  if (!group) {
    return (
      <>
        <p className="meta" style={{ marginBottom: 14 }}>The {BASELINE_META.totalRecords} surveyed institutions, by category. Select a card to see the list.</p>
        <div className="pulse" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          {INSTITUTION_GROUPS.map((g) => (
            <button key={g.key} className="stat" style={{ cursor: "pointer", textAlign: "left", font: "inherit", width: "100%" }} onClick={() => { setOpenKey(g.key); setQuery(""); }}>
              <div className="k">{g.title}</div>
              <div className="v">{g.count}</div>
              <div className="delta" style={{ color: "var(--flame)" }}>View list →</div>
            </button>
          ))}
        </div>
      </>
    );
  }

  const rows = group.rows.filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase()) || (r.sub || "").toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{group.title}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="field" style={{ padding: "5px 10px", minWidth: 180 }} placeholder="Search name or sub-county…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn" style={{ padding: "6px 12px" }} onClick={() => setOpenKey(null)}>← All categories</button>
        </div>
      </div>
      <table className="tbl">
        <thead><tr><th style={{ width: 60 }}>#</th><th>Institution</th><th>Sub-county</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name + i}><td className="mono meta">{i + 1}</td><td>{r.name}</td><td className="meta">{r.sub || "—"}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan={3}><Note>No institutions match “{query}”.</Note></td></tr>}
        </tbody>
      </table>
      <div className="meta" style={{ padding: "10px 16px" }}>{rows.length} of {group.count} shown</div>
    </div>
  );
}
