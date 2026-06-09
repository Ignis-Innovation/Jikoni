import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Input, Label, Select, Textarea, Badge, PageHeader, StatChip, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { formatDate, formatMoney, statusTone } from "@/lib/utils";
import { resourceIcon } from "@/lib/spine/icons";
import type { Resource, Field, Column } from "@/lib/spine/resources";

type Caps = { create: boolean; edit: boolean; del: boolean };
type Row = Record<string, unknown>;

export function ResourceView({ resource, caps }: { resource: Resource; caps: Caps }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const searchCol = resource.columns[0]?.key ?? "id";
  const Icon = resourceIcon(resource.slug, resource.group);

  // The first badge column (status/stage/etc.) drives the summary band.
  const groupCol = resource.columns.find((c) => c.kind === "badge");
  const summary = useMemo(() => {
    if (!groupCol) return [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[groupCol.key];
      if (v == null || v === "") continue;
      const key = String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows, groupCol]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from(resource.table).select(resource.select).is("deleted_at", null);
    if (resource.partyType) q = q.eq("type", resource.partyType);
    if (search) q = q.ilike(searchCol, `%${search}%`);
    const { data } = await q.order(resource.orderBy ?? "created_at", { ascending: false }).limit(200);
    setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, [supabase, resource, search, searchCol]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  }

  async function onDelete(row: Row) {
    const label = String(row[searchCol] ?? row.code ?? "this record");
    if (!confirm(`Delete "${label}"? This soft-deletes the record.`)) return;
    const { error } = await supabase.from(resource.table).update({ deleted_at: new Date().toISOString() }).eq("id", row.id as string);
    if (error) return flash(`Error: ${error.message}`);
    setRows((r) => r.filter((x) => x.id !== row.id));
    flash("Deleted.");
  }

  function renderCell(col: Column, row: Row) {
    const v = row[col.key];
    if (v == null || v === "") return <span className="text-muted-foreground">—</span>;
    if (col.kind === "money") return formatMoney(Number(v), (row.currency_code as string) ?? "KES");
    if (col.kind === "date") return formatDate(v as string);
    if (col.kind === "badge") return <Badge tone={statusTone(v)}>{String(v).replace(/_/g, " ")}</Badge>;
    return String(v);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={resource.group}
        title={resource.title}
        subtitle={resource.subtitle}
        icon={Icon}
        actions={caps.create ? (
          <Button onClick={() => { setEditing(null); setPanelOpen(true); }}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        ) : null}
      />

      {!loading && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatChip label={`total ${resource.title.toLowerCase()}`} value={rows.length} tone="blue" />
          {summary.map(([k, n]) => (
            <StatChip key={k} label={k.replace(/_/g, " ")} value={n} tone={statusTone(k)} />
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={`Search ${resource.title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {!loading && (
          <span className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "record" : "records"}{search ? " matched" : ""}
          </span>
        )}
      </div>

      <Table>
        <THead>
          {resource.columns.map((c) => <TH key={c.key}>{c.label}</TH>)}
          <TH />
        </THead>
        <TBody>
          {loading ? (
            [...Array(5)].map((_, i) => (
              <tr key={i}><td colSpan={resource.columns.length + 1} className="px-5 py-4"><div className="h-4 w-full animate-pulse rounded bg-muted" /></td></tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={resource.columns.length + 1} className="px-4 py-14 text-center">
                <p className="text-sm text-muted-foreground">No {resource.title.toLowerCase()} yet.</p>
                {caps.create && (
                  <Button className="mt-3" onClick={() => { setEditing(null); setPanelOpen(true); }}>
                    <Plus className="h-4 w-4" /> Add the first
                  </Button>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <TR key={String(row.id)}>
                {resource.columns.map((c, i) => (
                  <TD key={c.key} className={i === 0 ? "font-medium text-foreground" : undefined}>
                    {renderCell(c, row)}
                  </TD>
                ))}
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    {caps.edit && (
                      <button onClick={() => { setEditing(row); setPanelOpen(true); }} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {caps.del && (
                      <button onClick={() => onDelete(row)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <ResourceForm
        resource={resource}
        open={panelOpen}
        editing={editing}
        onClose={() => setPanelOpen(false)}
        onSaved={(m) => { setPanelOpen(false); flash(m); load(); }}
      />

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">{toast}</div>}
    </div>
  );
}

function ResourceForm({
  resource, open, editing, onClose, onSaved,
}: {
  resource: Resource;
  open: boolean;
  editing: Row | null;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [refOptions, setRefOptions] = useState<Record<string, { id: string; label: string }[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load ref-field dropdown options once when the panel opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    const init: Record<string, string> = {};
    for (const f of resource.fields) {
      const cur = editing?.[f.key];
      init[f.key] = cur == null ? "" : f.type === "money" ? String(Number(cur) / 100) : String(cur);
    }
    setForm(init);

    (async () => {
      const refFields = resource.fields.filter((f) => f.type === "ref" && f.ref);
      // Fetch every dropdown's options in parallel instead of one after another.
      const results = await Promise.all(
        refFields.map(async (f) => {
          let q = supabase.from(f.ref!.table).select(`id, ${f.ref!.labelKey}`).is("deleted_at", null).limit(500);
          if (f.ref!.typeFilter) q = q.eq("type", f.ref!.typeFilter);
          const { data } = await q;
          const opts = ((data as unknown as Row[]) ?? []).map((r) => ({ id: String(r.id), label: String(r[f.ref!.labelKey] ?? r.id) }));
          return [f.key, opts] as const;
        })
      );
      setRefOptions(Object.fromEntries(results));
    })();
  }, [open, editing, resource, supabase]);

  const valid = resource.fields.every((f) => !f.required || (form[f.key] && form[f.key].trim() !== ""));

  async function save(addAnother: boolean) {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const f of resource.fields) {
      const raw = form[f.key];
      if (raw == null || raw === "") { payload[f.key] = null; continue; }
      if (f.type === "money") payload[f.key] = Math.round(parseFloat(raw) * 100);
      else if (f.type === "number") payload[f.key] = Number(raw);
      else payload[f.key] = raw;
    }
    if (resource.partyType && !editing) payload.type = resource.partyType;

    const res = editing
      ? await supabase.from(resource.table).update(payload).eq("id", editing.id as string)
      : await supabase.from(resource.table).insert(payload);
    setSaving(false);
    if (res.error) return setError(res.error.message);

    if (addAnother) {
      const cleared: Record<string, string> = {};
      for (const f of resource.fields) cleared[f.key] = "";
      setForm(cleared);
    } else {
      onSaved(editing ? "Updated." : "Created.");
    }
  }

  function renderField(f: Field) {
    const val = form[f.key] ?? "";
    const set = (v: string) => setForm((s) => ({ ...s, [f.key]: v }));
    if (f.type === "textarea") return <Textarea rows={3} value={val} onChange={(e) => set(e.target.value)} />;
    if (f.type === "select")
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    if (f.type === "ref")
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {(refOptions[f.key] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      );
    return (
      <Input
        type={f.type === "date" ? "date" : f.type === "number" || f.type === "money" ? "number" : "text"}
        step={f.type === "money" ? "0.01" : undefined}
        value={val}
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  return (
    <Modal open={open} title={`${editing ? "Edit" : "Add"} — ${resource.title}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(false); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {resource.fields.map((f) => (
            <div key={f.key} className={f.half ? "" : "col-span-2"}>
              <Label required={f.required}>{f.label}</Label>
              {renderField(f)}
            </div>
          ))}
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" disabled={!valid || saving}>{saving ? "Saving…" : "Save"}</Button>
          {!editing && (
            <Button type="button" variant="outline" disabled={!valid || saving} onClick={() => save(true)}>Save &amp; add another</Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
