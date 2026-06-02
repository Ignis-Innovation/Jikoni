import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Renamed from middleware.ts per Next.js 16 (the "middleware" convention is
// deprecated in favour of "proxy"). Same behaviour: refresh the Supabase
// session cookie and guard private routes.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // All paths except static assets and image optimisation files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
