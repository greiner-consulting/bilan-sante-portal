"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

function safeNext(value: string): string {
  if (!value.startsWith("/")) return "/dashboard";
  if (value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/admin")) return "/dashboard";
  return value;
}

async function appBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/g, "");
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`.replace(/\/+$/g, "");
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const next = safeNext(String(formData.get("next") || "/dashboard"));

  if (!email) {
    redirect(
      `/login?error=${encodeURIComponent("Adresse e-mail requise.")}&next=${encodeURIComponent(next)}`
    );
  }

  const redirectTo = `${await appBaseUrl()}/auth/finish?next=${encodeURIComponent(next)}`;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(
        "Impossible d’envoyer le lien de connexion."
      )}&next=${encodeURIComponent(next)}`
    );
  }

  redirect(
    `/login?success=${encodeURIComponent(
      "Le lien de connexion a été envoyé. Vérifiez votre messagerie."
    )}&next=${encodeURIComponent(next)}`
  );
}
