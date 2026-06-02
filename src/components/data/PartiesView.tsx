import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Input, Label, Select, Badge, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { SlideOver } from "@/components/data/SlideOver";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";

type Party = {
  id: string;
  type: string;
  display_name: string;
  legal_name: string | null;
  kra_pin: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

const TYPES = ["vendor", "customer", "partner", "employee", "contact"] as const;
const TYPE_TONE: Record<string, "green" | "blue" | "amber" | "zinc"> = {
  vendor: "blue",
  customer: "green",
  partner: "amber",
  employee: "zinc",
  contact: "zinc",
};

type Caps = { create: boolean; edit: boolean; del: boolean };

export function PartiesView({ caps }: { caps: Caps }) {
  const [rows, setRows] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("parties")
      .select("id,type,display_name,legal_name,kra_pin,email,phone,status,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (typeFilter) q = q.eq("type", typeFilter);
    if (search) q = q.ilike("display_name", `%${search}%`);
    const { data } = await q;
    setRows((data as Party[]) ?? []);
    setLoading(false);
  }, [supabase, search, typeFilter]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0); // debounce search 300ms
    return () => clearTimeout(t);
  }, [load, search]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function onDelete(p: Party) {
    if (!confirm(`Delete party "${p.display_name}"? This soft-deletes the record.`)) return;
    const { error } = await supabase.from("parties").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return flash(`Error: ${error.message}`);
    setRows((r) => r.filter((x) => x.id !== p.id));
    flash("Party deleted.");
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Spine"
        title="Parties"
        subtitle="Single source of truth for everyone Ignis deals with."
        actions={caps.create ? (
          <Button onClick={() => { setEditing(null); setPanelOpen(true); }}>
            <Plus className="h-4 w-4" /> Add party
          </Button>
        ) : null}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search parties…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-40">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      <Table>
        <THead>
          <TH>Name</TH><TH>Type</TH><TH>KRA PIN</TH><TH>Email</TH><TH>Added</TH><TH />
        </THead>
        <TBody>
          {loading ? (
            [...Array(5)].map((_, i) => (
              <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-muted" /></td></tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-14 text-center">
                <p className="text-sm text-muted-foreground">No parties yet.</p>
                {caps.create && (
                  <Button className="mt-3" onClick={() => { setEditing(null); setPanelOpen(true); }}>
                    <Plus className="h-4 w-4" /> Add the first party
                  </Button>
                )}
              </td>
            </tr>
          ) : (
            rows.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium text-foreground">{p.display_name}</TD>
                <TD><Badge tone={TYPE_TONE[p.type] ?? "zinc"}>{p.type}</Badge></TD>
                <TD>{p.kra_pin ?? "—"}</TD>
                <TD>{p.email ?? "—"}</TD>
                <TD>{formatDate(p.created_at)}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    {caps.edit && (
                      <button onClick={() => { setEditing(p); setPanelOpen(true); }} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {caps.del && (
                      <button onClick={() => onDelete(p)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive" aria-label="Delete">
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

      <PartyForm
        open={panelOpen}
        editing={editing}
        onClose={() => setPanelOpen(false)}
        onSaved={(msg) => { setPanelOpen(false); flash(msg); load(); }}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}

function PartyForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Party | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState({ type: "vendor", display_name: "", legal_name: "", kra_pin: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              type: editing.type,
              display_name: editing.display_name,
              legal_name: editing.legal_name ?? "",
              kra_pin: editing.kra_pin ?? "",
              email: editing.email ?? "",
              phone: editing.phone ?? "",
            }
          : { type: "vendor", display_name: "", legal_name: "", kra_pin: "", email: "", phone: "" }
      );
    }
  }, [open, editing]);

  const valid = form.display_name.trim().length > 0 && !!form.type;

  async function save(addAnother: boolean) {
    setSaving(true);
    setError(null);
    const payload = {
      type: form.type,
      display_name: form.display_name.trim(),
      legal_name: form.legal_name.trim() || null,
      kra_pin: form.kra_pin.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
    };
    const res = editing
      ? await supabase.from("parties").update(payload).eq("id", editing.id)
      : await supabase.from("parties").insert(payload);
    setSaving(false);
    if (res.error) return setError(res.error.message);
    if (addAnother) {
      setForm({ type: form.type, display_name: "", legal_name: "", kra_pin: "", email: "", phone: "" });
    } else {
      onSaved(editing ? "Party updated." : "Party created.");
    }
  }

  return (
    <SlideOver open={open} title={editing ? "Edit party" : "Add party"} onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); save(false); }}
        className="space-y-4"
      >
        <div>
          <Label required>Type</Label>
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div>
          <Label required>Display name</Label>
          <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </div>
        <div>
          <Label>Legal name</Label>
          <Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
        </div>
        <div>
          <Label>KRA PIN</Label>
          <Input value={form.kra_pin} onChange={(e) => setForm({ ...form, kra_pin: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" disabled={!valid || saving}>{saving ? "Saving…" : "Save"}</Button>
          {!editing && (
            <Button type="button" variant="outline" disabled={!valid || saving} onClick={() => save(true)}>
              Save &amp; add another
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </SlideOver>
  );
}
