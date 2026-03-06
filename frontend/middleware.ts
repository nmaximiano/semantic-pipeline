import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase-server";

// Pages that require authentication
const AUTH_REQUIRED = ["/dashboard", "/sessions", "/plans", "/feedback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next({ request });
  const supabase = createSupabaseMiddlewareClient(request, response);
  const { data: { user } } = await supabase.auth.getUser();

  const needsAuth = AUTH_REQUIRED.some((p) => pathname.startsWith(p));

  // Not logged in → login
  if (!user && needsAuth) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/sessions/:path*",
    "/plans/:path*",
    "/feedback/:path*",
  ],
};
