"use server";
import { getCurrentUser } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

/**
 * Submit a record into the spine approvals engine (PRD §1.4).
 * Resolves an active chain for the module/entity (matching amount band when
 * present), creates a pending approval_request, and notifies approvers.
 * Returns the approval_request id so the caller can store it on the entity.
 */
export async function submitForApproval(args: {
  entityType: string;
  entityId: string;
  module: string;
  amountMinor?: number;
  label?: string;
}): Promise<{ ok: boolean; requestId?: string; message: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "Not authenticated." };
  const supabase = await createClient();

  // Find an active chain whose conditions fit (amount band optional).
  const { data: chains } = await supabase
    .from("approval_chains")
    .select("id, conditions")
    .eq("module", args.module)
    .eq("entity_type", args.entityType)
    .eq("active", true);

  let chainId: string | null = null;
  for (const c of chains ?? []) {
    const cond = (c.conditions ?? {}) as { amount_min?: number; amount_max?: number };
    const amt = args.amountMinor ?? 0;
    const okMin = cond.amount_min == null || amt >= cond.amount_min;
    const okMax = cond.amount_max == null || amt <= cond.amount_max;
    if (okMin && okMax) { chainId = c.id; break; }
  }

  const { data: req, error } = await supabase
    .from("approval_requests")
    .insert({
      entity_type: args.entityType,
      entity_id: args.entityId,
      chain_id: chainId,
      status: "pending",
      requested_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  await supabase.rpc("notify_approvers", {
    p_type: "approval.requested",
    p_title: `Approval needed: ${args.label ?? args.entityType}`,
    p_body: `${me.full_name ?? me.email} submitted a ${args.entityType.replace(/_/g, " ")} for approval.`,
    p_link: `/procurement`,
  });

  return { ok: true, requestId: req.id, message: "Submitted for approval." };
}

/** Approve / reject / request-changes on a request, then update its entity. */
export async function actOnApproval(args: {
  requestId: string;
  action: "approve" | "reject" | "request_changes";
  comment?: string;
}): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "Not authenticated." };
  if (!me.isSuperAdmin && !me.permissions.has("approvals.act")) {
    return { ok: false, message: "You can't act on approvals." };
  }
  if ((args.action === "reject" || args.action === "request_changes") && !args.comment?.trim()) {
    return { ok: false, message: "A reason/comment is required." };
  }
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("approval_requests")
    .select("id, entity_type, entity_id, current_step, requested_by")
    .eq("id", args.requestId)
    .single();
  if (!req) return { ok: false, message: "Approval request not found." };

  await supabase.from("approval_actions").insert({
    request_id: req.id,
    step_no: req.current_step ?? 1,
    actor_user_id: me.id,
    action: args.action,
    comment: args.comment ?? null,
  });

  const newStatus =
    args.action === "approve" ? "approved" : args.action === "reject" ? "rejected" : "changes_requested";
  await supabase.from("approval_requests").update({ status: newStatus }).eq("id", req.id);

  // Reflect the decision on the underlying entity.
  const entityStatus =
    args.action === "approve" ? "approved" : args.action === "reject" ? "rejected" : "draft";
  await supabase.from(req.entity_type).update({ status: entityStatus }).eq("id", req.entity_id);

  // Notify the requester of the outcome.
  if (req.requested_by) {
    await supabase.rpc("notify", {
      p_user_id: req.requested_by,
      p_type: "approval.decided",
      p_title: `Your ${req.entity_type.replace(/_/g, " ")} was ${newStatus}`,
      p_body: args.comment ?? null,
      p_link: "/procurement",
    });
  }

  return { ok: true, message: `Marked ${newStatus}.` };
}
