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

type MeRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: string[];
};

/**
 * Loads the signed-in user with their roles + flattened permission keys in a
 * single round-trip (the me() RPC resolves everything from auth.uid()).
 * Wrapped in React cache() so the layout and the page share one result per
 * request. The proxy validates/refreshes the session before render, so the
 * signed JWT is trusted here without a second getUser() network call.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("me");
  if (!data) return null;
  const me = data as MeRow;

  const roles = me.roles ?? [];
  const permissions = new Set(me.permissions ?? []);
  return {
    id: me.id,
    email: me.email ?? "",
    full_name: me.full_name,
    avatar_url: me.avatar_url,
    roles,
    permissions,
    isSuperAdmin: roles.includes("super_admin"),
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
