// app/reset-password/page.tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

async function getBaseUrl() {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, "");

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

async function requestResetAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") || "").trim();
  if (!email) redirect("/reset-password?error=Email%20obligatoire.");

  const supabase = await createSupabaseServerClient();
  const baseUrl = await getBaseUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${baseUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error("[reset-password] resetPasswordForEmail error:", error);
    redirect("/reset-password?error=Impossible%20d%27envoyer%20l%27email.");
  }

  redirect(
    "/reset-password?success=Email%20envoy%C3%A9.%20V%C3%A9rifie%20ta%20bo%C3%AEte%20de%20r%C3%A9ception."
  );
}

async function updatePasswordAction(formData: FormData) {
  "use server";

  const password = String(formData.get("password") || "");
  if (password.length < 8) {
    redirect(
      "/reset-password?error=Mot%20de%20passe%20trop%20court%20(8%20caract%C3%A8res%20min)."
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error("[reset-password] updateUser error:", error);
    redirect(
      "/reset-password?error=Impossible%20de%20mettre%20%C3%A0%20jour%20le%20mot%20de%20passe."
    );
  }

  redirect("/login?success=Mot%20de%20passe%20mis%20%C3%A0%20jour.%20Reconnecte-toi.");
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string };
}) {
  const error = searchParams?.error ? decodeURIComponent(searchParams.error) : null;
  const success = searchParams?.success
    ? decodeURIComponent(searchParams.success)
    : null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Réinitialiser le mot de passe</h1>

      {error && (
        <div
          style={{
            background: "#ffecec",
            border: "1px solid #ffb3b3",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            background: "#ecffef",
            border: "1px solid #b3ffbf",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {success}
        </div>
      )}

      {!user ? (
        <>
          <p style={{ marginBottom: 12 }}>
            Entre ton email : tu recevras un lien pour réinitialiser ton mot de passe.
          </p>

          <form action={requestResetAction} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              />
            </label>

            <button
              type="submit"
              style={{
                padding: 12,
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
              }}
            >
              Envoyer le lien
            </button>
          </form>

          <div style={{ marginTop: 16 }}>
            <a href="/login">Retour connexion</a>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginBottom: 12 }}>
            Session de récupération active pour <b>{user.email}</b> — choisis un nouveau mot de passe :
          </p>

          <form action={updatePasswordAction} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Nouveau mot de passe</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              />
            </label>

            <button
              type="submit"
              style={{
                padding: 12,
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
              }}
            >
              Mettre à jour
            </button>
          </form>
        </>
      )}
    </main>
  );
}