import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  entitlementIsUsable,
  getActiveEntitlementForUser,
  isAdminUser,
} from "@/lib/auth/access-control";
import BrandMark from "@/app/dashboard/[id]/BrandMark";
import LoginForm from "./LoginForm";

type PageProps = {
  searchParams?: Promise<{ error?: string; success?: string; next?: string }>;
};

function decodeMaybe(v?: string) {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default async function LoginPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const errorMsg = decodeMaybe(sp.error);
  const successMsg = decodeMaybe(sp.success);
  const next = decodeMaybe(sp.next) ?? "/dashboard";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let existingSessionMode: "admin" | "guest_without_access" | null = null;

  if (user) {
    const admin = await isAdminUser(user.id);
    if (admin) {
      existingSessionMode = "admin";
    } else {
      const entitlement = await getActiveEntitlementForUser(user.id);
      if (entitlementIsUsable(entitlement)) {
        redirect(next);
      }
      existingSessionMode = "guest_without_access";
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center gap-4">
            <BrandMark />
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Greiner Consulting
              </h1>
              <p className="text-sm text-slate-600">
                Portail sécurisé — Bilan de Santé
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl font-semibold text-slate-900">
              Connexion client sécurisée
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-700">
              Saisissez votre adresse e-mail. Un lien de connexion temporaire vous
              sera envoyé. L’accès reste contrôlé côté serveur par droits, durée
              d’activation et appartenance aux sessions.
            </p>
          </div>

          <div className="mt-8">
            {existingSessionMode === "admin" ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Une session administrateur est déjà active. Déconnectez-vous avant
                d’utiliser un accès invité.
              </div>
            ) : null}

            {existingSessionMode === "guest_without_access" ? (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Cette session utilisateur existe déjà, mais son accès invité n’est pas actif.
                Déconnectez-vous puis redemandez un lien de connexion si nécessaire.
              </div>
            ) : null}

            {errorMsg ? (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {errorMsg}
              </div>
            ) : null}

            {successMsg ? (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                {successMsg}
              </div>
            ) : null}

            {existingSessionMode ? (
              <div className="space-y-3">
                {existingSessionMode === "admin" ? (
                  <Link
                    href="/dashboard"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Aller au dashboard administrateur
                  </Link>
                ) : null}

                <Link
                  href="/logout?next=/login"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                >
                  Se déconnecter
                </Link>
              </div>
            ) : (
              <LoginForm next={next} />
            )}
          </div>

          <div className="mt-8 text-xs text-slate-500">
            Besoin d’un accès ou d’une prolongation ? Contactez Greiner Consulting
            depuis l’adresse qui vous a été attribuée.
          </div>
        </section>

        <aside className="rounded-3xl border bg-white p-8 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">
            Principes de sécurité
          </h3>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            <li>Accès par lien magique à durée limitée</li>
            <li>Droits activés ou révoqués côté serveur</li>
            <li>Contrôle d’appartenance sur chaque session</li>
            <li>Historique et traçabilité des actions</li>
          </ul>

          <div className="mt-8 space-y-3 text-xs text-slate-500">
            <div>
              <Link className="underline" href="/">
                Retour à l’accueil
              </Link>
            </div>
            <div>
              <Link className="underline" href="/admin/login">
                Accès administrateur
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
