"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type Step = "processing" | "error";

function safeNext(value: string | null): string {
  const next = String(value ?? "/dashboard");
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

export default function AuthFinishPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("processing");
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

    async function finalizeAuth() {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const code = searchParams.get("code");
        const tokenHash = searchParams.get("token_hash");
        const type = searchParams.get("type") as
          | "signup"
          | "invite"
          | "magiclink"
          | "recovery"
          | "email_change"
          | null;

        let authError: string | null = null;

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) authError = error.message;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) authError = error.message;
        } else if (hash.get("access_token") && hash.get("refresh_token")) {
          const { error } = await supabase.auth.setSession({
            access_token: String(hash.get("access_token")),
            refresh_token: String(hash.get("refresh_token")),
          });
          if (error) authError = error.message;
        } else {
          authError = "Callback invalide.";
        }

        if (authError) {
          if (!cancelled) {
            setStep("error");
            setErrorMessage(authError);
          }
          return;
        }

        const syncRes = await fetch("/api/auth/sync-invitation", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ next }),
        });

        const syncData = await syncRes.json().catch(() => null);
        if (!syncRes.ok || !syncData?.ok) {
          throw new Error(syncData?.error || "Impossible d’activer l’accès invité.");
        }

        router.replace(next);
      } catch (error: any) {
        if (!cancelled) {
          setStep("error");
          setErrorMessage(error?.message || "Impossible de finaliser la connexion.");
        }
      }
    }

    finalizeAuth();

    return () => {
      cancelled = true;
    };
  }, [next, router, searchParams, supabase]);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl border bg-white p-10 shadow-sm">
        {step === "processing" ? (
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold text-slate-900">
              Finalisation de la connexion…
            </h1>
            <p className="text-sm leading-6 text-slate-700">
              Votre lien de connexion est en cours de validation. Merci de patienter.
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
