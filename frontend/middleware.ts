import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase-server";

// Pages that require authentication + beta/pro plan
const BETA_ONLY = ["/dashboard", "/sessions", "/plans", "/feedback"];
// Pages that require authentication (any plan)
const AUTH_ONLY = ["/waitlist"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next({ request });
  const supabase = createSupabaseMiddlewareClient(request, response);
  const { data: { user } } = await supabase.auth.getUser();

  const isBetaOnly = BETA_ONLY.some((p) => pathname.startsWith(p));
  const isAuthOnly = AUTH_ONLY.some((p) => pathname.startsWith(p));

  // Not logged in → login
  if (!user && (isBetaOnly || isAuthOnly)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user) {
    // Check plan from DB (server-side, cannot be spoofed by client)
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();
    const plan = profile?.plan ?? "free";
    const hasAccess = plan === "beta" || plan === "pro";

    // Free users trying to access beta-only pages → waitlist
    if (isBetaOnly && !hasAccess) {
      return NextResponse.redirect(new URL("/waitlist", request.url));
    }

    // Beta/pro users hitting /waitlist → dashboard
    if (pathname.startsWith("/waitlist") && hasAccess) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/sessions/:path*",
    "/plans/:path*",
    "/feedback/:path*",
    "/waitlist/:path*",
    "/waitlist",
  ],
};
