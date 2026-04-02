import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  entitlementIsUsable,
  getActiveEntitlementForUser,
  isAdminUser,
  syncPendingInvitationForUser,
} from "@/lib/auth/access-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmailOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change";

type AppRole = "admin" | "guest";

function sanitizeNext(rawValue: string | null | undefined, role: AppRole): string {
  const fallback = "/dashboard";
  const next = String(rawValue ?? "").trim();

  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;

  if (next.startsWith("/auth")) return fallback;
  if (next.startsWith("/logout")) return fallback;
  if (next === "/login" || next.startsWith("/login?")) return fallback;
  if (next === "/admin/login" || next.startsWith("/admin/login?")) return fallback;

  if (role !== "admin" && next.startsWith("/admin")) {
    return fallback;
  }

  return next;
}

function loginRedirect(requestUrl: URL, message: string, next?: string) {
  const url = new URL("/login", requestUrl.origin);
  url.searchParams.set("error", message);

  if (next) {
    url.searchParams.set("next", next);
  }

  return NextResponse.redirect(url);
}

function humanizeAuthError(error: { message?: string } | null | undefined): string {
  const message = String(error?.message ?? "").toLowerCase();

  if (message.includes("otp_expired")) {
    return "Lien expiré. Merci de redemander un lien de connexion.";
  }

  if (message.includes("both auth code and code verifier should be non-empty")) {
    return "Lien invalide ou ouvert dans une autre session. Merci de redemander un lien de connexion.";
  }

  if (message.includes("invalid request")) {
    return "Lien invalide. Merci de redemander un lien de connexion.";
  }

  return "Lien invalide ou expiré.";
}

async function finalizeAuthenticatedRedirect(params: {
  requestUrl: URL;
  requestedNext: string;
}) {
  const { requestUrl, requestedNext } = params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("[auth/callback] getUser error after auth:", userError);
    return loginRedirect(
      requestUrl,
      "Impossible de finaliser votre session.",
      sanitizeNext(requestedNext, "guest")
    );
  }

  if (!user?.id) {
    console.error("[auth/callback] missing user after auth callback");
    return loginRedirect(
      requestUrl,
      "Session de connexion introuvable après validation du lien.",
      sanitizeNext(requestedNext, "guest")
    );
  }

  try {
    await syncPendingInvitationForUser({
      userId: user.id,
      email: user.email ?? null,
    });
  } catch (syncError) {
    console.error("[auth/callback] invitation sync failed:", syncError);
    return loginRedirect(
      requestUrl,
      "Impossible de finaliser votre accès client. Merci de réessayer.",
      sanitizeNext(requestedNext, "guest")
    );
  }

  const admin = await isAdminUser(user.id);

  if (!admin) {
    const entitlement = await getActiveEntitlementForUser(user.id);

    if (!entitlementIsUsable(entitlement)) {
      await supabase.auth.signOut();

      return loginRedirect(
        requestUrl,
        "Votre accès client n’est pas actif. Merci de redemander un lien de connexion.",
        "/dashboard"
      );
    }
  }

  const destination = sanitizeNext(requestedNext, admin ? "admin" : "guest");
  return NextResponse.redirect(new URL(destination, requestUrl.origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedNext = url.searchParams.get("next") ?? "/dashboard";

  try {
    const supabase = await createSupabaseServerClient();

    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") as EmailOtpType | null;

    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });

      if (error) {
        console.error("[auth/callback] verifyOtp error:", error);
        return loginRedirect(
          url,
          humanizeAuthError(error),
          sanitizeNext(requestedNext, "guest")
        );
      }

      return finalizeAuthenticatedRedirect({
        requestUrl: url,
        requestedNext,
      });
    }

    const code = url.searchParams.get("code");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("[auth/callback] exchangeCodeForSession error:", error);
        return loginRedirect(
          url,
          humanizeAuthError(error),
          sanitizeNext(requestedNext, "guest")
        );
      }

      return finalizeAuthenticatedRedirect({
        requestUrl: url,
        requestedNext,
      });
    }

    return loginRedirect(
      url,
      "Callback invalide.",
      sanitizeNext(requestedNext, "guest")
    );
  } catch (error) {
    console.error("[auth/callback] HARD FAIL:", error);
    return loginRedirect(
      url,
      "Erreur serveur lors de la validation du lien.",
      sanitizeNext(requestedNext, "guest")
    );
  }
}