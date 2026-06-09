import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: Set<string>;
  isSuperAdmin: boolean;
};

type AuthState = {
  loading: boolean;
  user: CurrentUser | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  loading: true,
  user: null,
  signOut: async () => {},
  refresh: async () => {},
});

type MeRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  roles: string[] | null;
  permissions: string[] | null;
};

async function loadMe(): Promise<CurrentUser | null> {
  try {
    const { data, error } = await supabase.rpc("me");
    if (error || !data) return null;
    const me = data as MeRow;
    const roles = me.roles ?? [];
    return {
      id: me.id,
      email: me.email ?? "",
      full_name: me.full_name,
      avatar_url: me.avatar_url,
      roles,
      permissions: new Set(me.permissions ?? []),
      isSuperAdmin: roles.includes("super_admin"),
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refresh = async () => {
    setUser(await loadMe());
  };

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;

    // Initial load — always clear `loading`, even if the RPC fails.
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (active && data.session) setUser(await loadMe());
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    })();

    // IMPORTANT: never `await` Supabase calls directly inside this callback —
    // it can deadlock the auth client. Defer the profile fetch to a microtask.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        setUser(null);
        return;
      }
      if (session) setTimeout(() => { if (active) loadMe().then((u) => active && setUser(u)); }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return <AuthContext.Provider value={{ loading, user, signOut, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function can(user: CurrentUser | null, permissionKey: string): boolean {
  if (!user) return false;
  return user.isSuperAdmin || user.permissions.has(permissionKey);
}

export function hasModule(user: CurrentUser | null, moduleKey: string): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  for (const p of user.permissions) if (p.startsWith(moduleKey + ".")) return true;
  return false;
}
