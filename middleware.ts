import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isBypassEnabled(): boolean {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/admin/login" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/public")
  );
}

function isAdminProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/admin");
}

function isGuestProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard");
}

function buildLoginRedirect(req: NextRequest, pathname: string) {
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = pathname;
  const next = `${req.nextUrl.pathname}${req.nextUrl.search || ""}`;
  loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isBypassEnabled()) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!isAdminProtectedPath(pathname) && !isGuestProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isAdminProtectedPath(pathname)) {
      return buildLoginRedirect(req, "/admin/login");
    }
    return buildLoginRedirect(req, "/login");
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
