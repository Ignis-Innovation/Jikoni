import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cache } from "react";

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: Set<string>;
  isSuperAdmin: boolean;
};

/**
 * Loads the signed-in user with their roles + flattened permission keys.
 * Wrapped in React cache() so the layout and the page share one result per
 * request instead of each hitting Supabase again.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Profile + roles fetched in parallel (independent queries).
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from("users").select("id, email, full_name, avatar_url").eq("id", user.id).single(),
    supabase.from("user_roles").select("roles(key, role_permissions(permissions(key)))").eq("user_id", user.id),
  ]);

  const roles = new Set<string>();
  const permissions = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (roleRows ?? []) as any[]) {
    const role = r.roles;
    if (!role) continue;
    roles.add(role.key);
    for (const rp of role.role_permissions ?? []) {
      if (rp.permissions?.key) permissions.add(rp.permissions.key);
    }
  }

  const isSuperAdmin = roles.has("super_admin");
  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    full_name: profile?.full_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    roles: [...roles],
    permissions,
    isSuperAdmin,
  };
});

/** Throws (redirect to /login) if not signed in; returns the user otherwise. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function can(user: CurrentUser, permissionKey: string): boolean {
  return user.isSuperAdmin || user.permissions.has(permissionKey);
}

/** True if the user holds any permission within a module (controls nav visibility). */
export function hasModule(user: CurrentUser, moduleKey: string): boolean {
  if (user.isSuperAdmin) return true;
  for (const p of user.permissions) {
    if (p.startsWith(moduleKey + ".")) return true;
  }
  return false;
}
