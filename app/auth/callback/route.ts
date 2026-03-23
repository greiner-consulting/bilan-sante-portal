// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/dashboard";

  try {
    const supabase = await createSupabaseServerClient();

    // ✅ Reset password flow (token_hash + type=recovery)
    const token_hash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") as EmailOtpType | null;

    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });

      if (error) {
        console.error("[auth/callback] verifyOtp error:", error);
        return NextResponse.redirect(
          new URL("/login?error=Lien%20invalide%20ou%20expir%C3%A9.", url.origin)
        );
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }

    // ✅ PKCE flow (code)
    const code = url.searchParams.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("[auth/callback] exchangeCodeForSession error:", error);
        return NextResponse.redirect(
          new URL("/login?error=Session%20invalide.", url.origin)
        );
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }

    return NextResponse.redirect(
      new URL("/login?error=Callback%20invalide.", url.origin)
    );
  } catch (e) {
    console.error("[auth/callback] HARD FAIL:", e);
    return NextResponse.redirect(
      new URL("/login?error=Erreur%20serveur%20callback%20(500).", url.origin)
    );
  }
}