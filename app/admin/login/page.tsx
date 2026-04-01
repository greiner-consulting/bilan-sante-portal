import Link from "next/link";
import { redirect } from "next/navigation";
import BrandMark from "@/app/dashboard/[id]/BrandMark";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isAdminUser } from "@/lib/auth/access-control";
import AdminLoginForm from "./AdminLoginForm";

type PageProps = {
  searchParams?: Promise<{ error?: string; next?: string }>;
};

function decodeMaybe(v?: string) {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function safeNext(value?: string | null): string {
  const next = String(value ?? "/admin/dashboard");
  if (!next.startsWith("/")) return "/admin/dashboard";
  if (next.startsWith("//")) return "/admin/dashboard";
  return next;
}

export default async function AdminLoginPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const errorMsg = decodeMaybe(sp.error);
  const next = safeNext(decodeMaybe(sp.next) ?? "/admin/dashboard");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && (await isAdminUser(user.id))) {
    redirect(next);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-3xl border bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center gap-4">
            <BrandMark />
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Greiner Consulting
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                Administration — Bilan de Santé
              </h1>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl font-semibold text-slate-900">
              Connexion administrateur
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-700">
              Connectez-vous avec votre adresse administrateur et votre mot de passe
              pour accéder au dashboard unique d’administration, à la gestion des
              accès invités et aux diagnostics réalisés.
            </p>
          </div>

          <div className="mt-8">
            {errorMsg ? (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {errorMsg}
              </div>
            ) : null}

            <AdminLoginForm next={next} />
          </div>
        </section>

        <aside className="rounded-3xl border bg-white p-8 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">
            Principes d’accès administrateur
          </h3>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            <li>Authentification par mot de passe réservée aux administrateurs.</li>
            <li>Gestion centralisée des diagnostics et des accès invités.</li>
            <li>Retour systématique vers le dashboard administrateur.</li>
          </ul>

          <div className="mt-8 text-xs text-slate-500">
            <Link className="underline" href="/login">
              Accès invité / client
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
