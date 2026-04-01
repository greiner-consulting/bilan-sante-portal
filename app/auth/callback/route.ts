// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { syncPendingInvitationForUser } from "@/lib/auth/access-control";

type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change";

function loginErrorRedirect(url: URL, message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, url.origin)
  );
}

async function finalizeAuthenticatedRedirect(params: {
  requestUrl: URL;
  next: string;
}) {
  const { requestUrl, next } = params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("[auth/callback] getUser error after auth:", userError);
    return loginErrorRedirect(
      requestUrl,
      "Impossible de finaliser votre session."
    );
  }

  if (!user?.id) {
    console.error("[auth/callback] missing user after auth callback");
    return loginErrorRedirect(
      requestUrl,
      "Session de connexion introuvable après validation du lien."
    );
  }

  try {
    await syncPendingInvitationForUser({
      userId: user.id,
      email: user.email ?? null,
    });
  } catch (syncError) {
    console.error("[auth/callback] invitation sync failed:", syncError);
    return loginErrorRedirect(
      requestUrl,
      "Impossible de finaliser votre accès client. Merci de réessayer."
    );
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/dashboard";

  try {
    const supabase = await createSupabaseServerClient();

    const token_hash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") as EmailOtpType | null;

    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });

      if (error) {
        console.error("[auth/callback] verifyOtp error:", error);
        return loginErrorRedirect(url, "Lien invalide ou expiré.");
      }

      return finalizeAuthenticatedRedirect({
        requestUrl: url,
        next,
      });
    }

    const code = url.searchParams.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("[auth/callback] exchangeCodeForSession error:", error);
        return loginErrorRedirect(url, "Session invalide.");
      }

      return finalizeAuthenticatedRedirect({
        requestUrl: url,
        next,
      });
    }

    return loginErrorRedirect(url, "Callback invalide.");
  } catch (e) {
    console.error("[auth/callback] HARD FAIL:", e);
    return loginErrorRedirect(url, "Erreur serveur callback (500).");
  }
}
