import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
  /https:\/\/([^.]+)\.supabase\.co/
)?.[1] ?? "";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // @supabase/ssr usa cookies chunked: sb-{ref}-auth-token.0, .1, etc.
  const cookiePrefix = `sb-${PROJECT_REF}-auth-token`;
  const hasSession = request.cookies.getAll().some(
    (c) => c.name.startsWith(cookiePrefix) && c.value
  );

  if (pathname.startsWith("/dashboard") && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
