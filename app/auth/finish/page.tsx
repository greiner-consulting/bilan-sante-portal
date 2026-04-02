"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type Step = "redirecting" | "processing_legacy" | "error";

function safeNext(value: string | null | undefined): string {
  const next = String(value ?? "").trim();

  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  if (next.startsWith("/auth")) return "/dashboard";
  if (next.startsWith("/logout")) return "/dashboard";
  if (next === "/login" || next.startsWith("/login?")) return "/dashboard";
  if (next === "/admin/login" || next.startsWith("/admin/login?")) return "/dashboard";
  if (next.startsWith("/admin")) return "/dashboard";

  return next;
}

function buildCanonicalCallbackUrl(next: string, searchParams: URLSearchParams): string {
  const url = new URL("/auth/callback", window.location.origin);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (code) {
    url.searchParams.set("code", code);
  }

  if (tokenHash && type) {
    url.searchParams.set("token_hash", tokenHash);
    url.searchParams.set("type", type);
  }

  url.searchParams.set("next", next);

  return url.toString();
}

export default function AuthFinishPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("redirecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const next = safeNext(searchParams.get("next"));

  const supabase = useMemo(() => {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const currentSearch = new URLSearchParams(searchParams.toString());

        const hasCode = Boolean(currentSearch.get("code"));
        const hasTokenHash =
          Boolean(currentSearch.get("token_hash")) && Boolean(currentSearch.get("type"));

        if (hasCode || hasTokenHash) {
          window.location.replace(buildCanonicalCallbackUrl(next, currentSearch));
          return;
        }

        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (!accessToken || !refreshToken) {
          throw new Error("Lien invalide ou expiré. Merci de redemander un lien de connexion.");
        }

        if (!cancelled) {
          setStep("processing_legacy");
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (sessionError) {
          throw sessionError;
        }

        const syncRes = await fetch("/api/auth/sync-invitation", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });

        const syncData = await syncRes.json().catch(() => null);

        if (!syncRes.ok || !syncData?.ok) {
          throw new Error(
            syncData?.error || "Impossible de finaliser votre accès client."
          );
        }

        if (!syncData.isAdmin && !syncData.hasEntitlement) {
          await supabase.auth.signOut();
          throw new Error(
            "Votre accès client n’est pas actif. Merci de redemander un lien de connexion."
          );
        }

        const destination = syncData.isAdmin ? "/dashboard" : next;
        router.replace(destination);
      } catch (error: any) {
        if (!cancelled) {
          setStep("error");
          setErrorMessage(
            error?.message || "Impossible de finaliser la connexion."
          );
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [next, router, searchParams, supabase]);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl border bg-white p-10 shadow-sm">
        {step !== "error" ? (
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold text-slate-900">
              Finalisation de la connexion…
            </h1>
            <p className="text-sm leading-6 text-slate-700">
              {step === "redirecting"
                ? "Redirection vers le callback sécurisé…"
                : "Traitement d’un ancien lien de connexion en cours…"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold text-slate-900">
              Connexion impossible
            </h1>

            <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {errorMessage ?? "Le lien de connexion est invalide ou expiré."}
            </p>

            <a
              href={`/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(
                "Lien invalide ou expiré. Merci de redemander un lien de connexion."
              )}`}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
            >
              Revenir à la page de connexion invité
            </a>
          </div>
        )}
      </div>
    </main>
  );
}