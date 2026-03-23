// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // ✅ Bypass dev (double lecture pour éviter les soucis d'env)
  const bypass =
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1";

  if (bypass) {
    return NextResponse.next();
  }

  // ✅ Autoriser routes publiques + assets
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/public");

  if (isPublic) return NextResponse.next();

  // ✅ Protéger dashboard + API (si pas bypass)
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api")) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};