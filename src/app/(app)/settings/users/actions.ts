"use server";
import { getCurrentUser } from "@/lib/spine/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type InviteResult = { ok: boolean; message: string };

/** Invite a user by email and assign a role (PRD §1A invite flow). */
export async function inviteUser(formData: FormData): Promise<InviteResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "Not authenticated." };
  // Permission is checked server-side, never trusting the client (PRD §1.2).
  if (!me.isSuperAdmin && !me.permissions.has("identity.users.create")) {
    return { ok: false, message: "You don't have permission to invite users." };
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim();
  const roleKey = String(formData.get("role") || "").trim();
  if (!email || !roleKey) return { ok: false, message: "Email and role are required." };

  const admin = createAdminClient();

  // Create / invite the auth user. inviteUserByEmail also sends the invite email
  // when SMTP is configured; otherwise the account is still created (status invited).
  let userId: string | undefined;
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName || email },
  });
  if (inviteErr) {
    // Fall back to createUser if invite is unsupported (e.g. no SMTP in dev).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { full_name: fullName || email },
    });
    if (createErr && !/registered|exists/i.test(createErr.message)) {
      return { ok: false, message: createErr.message };
    }
    userId = created?.user?.id;
  } else {
    userId = invited?.user?.id;
  }

  if (!userId) {
    const { data: list } = await admin.auth.admin.listUsers();
    userId = list?.users.find((u: { email?: string }) => u.email === email)?.id;
  }
  if (!userId) return { ok: false, message: "Could not resolve the invited user." };

  // Ensure profile row + full name (the auth trigger creates it; update name).
  await admin.from("users").update({ full_name: fullName || email }).eq("id", userId);

  // Assign the role.
  const { data: role } = await admin.from("roles").select("id").eq("key", roleKey).single();
  if (!role) return { ok: false, message: "Unknown role." };
  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: userId, role_id: role.id }, { onConflict: "user_id,role_id" });
  if (roleErr) return { ok: false, message: roleErr.message };

  revalidatePath("/settings/users");
  return { ok: true, message: `Invited ${email} as ${roleKey}.` };
}
