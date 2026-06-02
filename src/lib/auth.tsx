import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

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
  const { data } = await supabase.rpc("me");
  if (!data) return null;
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
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refresh = async () => {
    const me = await loadMe();
    setUser(me);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) await refresh();
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        await refresh();
      }
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
