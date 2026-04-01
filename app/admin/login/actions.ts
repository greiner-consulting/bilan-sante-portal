"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isAdminUser } from "@/lib/auth/access-control";

function safeNext(value: string): string {
  if (!value.startsWith("/")) return "/admin/dashboard";
  if (value.startsWith("//")) return "/admin/dashboard";
  return value;
}

export async function adminLoginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const next = safeNext(String(formData.get("next") || "/admin/dashboard"));

  if (!email || !password) {
    redirect(
      `/admin/login?error=${encodeURIComponent(
        "Adresse e-mail et mot de passe requis."
      )}&next=${encodeURIComponent(next)}`
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect(
      `/admin/login?error=${encodeURIComponent(
        "Connexion administrateur impossible."
      )}&next=${encodeURIComponent(next)}`
    );
  }

  const admin = await isAdminUser(data.user.id);
  if (!admin) {
    await supabase.auth.signOut();
    redirect(
      `/admin/login?error=${encodeURIComponent(
        "Ce compte n’a pas de droits administrateur."
      )}&next=${encodeURIComponent(next)}`
    );
  }

  redirect(next);
}
