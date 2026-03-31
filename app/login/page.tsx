import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
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

  if (user) redirect(next);

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

            <LoginForm next={next} />
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

          <div className="mt-8 text-xs text-slate-500">
            <Link className="underline" href="/">
              Retour à l’accueil
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
