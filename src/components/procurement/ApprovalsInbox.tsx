import { useState } from "react";
import { Button, Badge } from "@/components/ui/primitives";
import { actOnApproval } from "@/lib/spine/approvals";
import { Check, X } from "lucide-react";

export type PendingItem = {
  id: string;
  entity_type: string;
  label: string;
  requested_by_name: string | null;
  created_at: string;
};

export function ApprovalsInbox({ items, onChanged }: { items: PendingItem[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    let comment: string | undefined;
    if (action === "reject") {
      comment = window.prompt("Reason for rejection?") ?? undefined;
      if (!comment) return;
    }
    setBusy(id);
    const res = await actOnApproval({ requestId: id, action, comment });
    setBusy(null);
    setMsg(res.message);
    onChanged();
  }

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing awaiting your approval. 🎉</p>;
  }

  return (
    <div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{it.label}</p>
              <p className="text-xs text-muted-foreground">
                <Badge tone="amber">{it.entity_type.replace(/_/g, " ")}</Badge>{" "}
                from {it.requested_by_name ?? "—"}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" disabled={busy === it.id} onClick={() => act(it.id, "approve")}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="danger" disabled={busy === it.id} onClick={() => act(it.id, "reject")}>
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
