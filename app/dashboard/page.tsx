import Link from "next/link";
import { redirect } from "next/navigation";
import { adminSupabase } from "@/lib/supabaseServer";
import {
  entitlementIsUsable,
  getActiveEntitlementForUser,
  getAuthenticatedUserOrThrow,
  isAdminUser,
} from "@/lib/auth/access-control";

type DashboardSessionRow = {
  id: string;
  status: string | null;
  phase: string | null;
  source_filename: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at?: string | null;
};

function phaseLabel(phase?: string | null) {
  switch (phase) {
    case "awaiting_trame":
      return "En attente de trame";
    case "dimension_iteration":
      return "Questions en cours";
    case "iteration_validation":
      return "Validation d’itération";
    case "final_objectives_validation":
      return "Validation des objectifs";
    case "report_ready":
      return "Rapport prêt";
    case "completed":
      return "Terminée";
    default:
      return phase ?? "n/a";
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function displayFileName(value?: string | null): string {
  const text = String(value ?? "").trim();
  return text || "Diagnostic sans trame renseignée";
}

async function loadDashboardContext() {
  const user = await getAuthenticatedUserOrThrow();
  const admin = await isAdminUser(user.id);

  if (!admin) {
    const entitlement = await getActiveEntitlementForUser(user.id);
    if (!entitlementIsUsable(entitlement)) {
      redirect("/login?error=Votre%20acc%C3%A8s%20client%20n%27est%20pas%20actif.");
    }
  }

  const db = adminSupabase();
  const { data, error } = await db
    .from("diagnostic_sessions")
    .select("id, status, phase, source_filename, created_at, updated_at, deleted_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`DASHBOARD_LOAD_FAILED: ${error.message}`);
  }

  return {
    user,
    isAdmin: admin,
    sessions: (Array.isArray(data) ? data : []) as DashboardSessionRow[],
  };
}

export default async function DashboardPage() {
  const { user, isAdmin, sessions } = await loadDashboardContext();
  const existingSession = sessions[0] ?? null;
  const canCreateNew = isAdmin || !existingSession;
  const logoutHref = isAdmin ? "/auth/logout?next=/admin/login" : "/auth/logout?next=/login";

  async function createSession() {
    "use server";

    const user = await getAuthenticatedUserOrThrow();
    const admin = await isAdminUser(user.id);
    const db = adminSupabase();

    if (!admin) {
      const entitlement = await getActiveEntitlementForUser(user.id);
      if (!entitlementIsUsable(entitlement)) {
        redirect("/login?error=Votre%20acc%C3%A8s%20client%20n%27est%20pas%20actif.");
      }

      const { data: existing, error: existingError } = await db
        .from("diagnostic_sessions")
        .select("id")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existing?.id) {
        redirect(`/dashboard/${existing.id}`);
      }
    }

    const { data, error } = await db
      .from("diagnostic_sessions")
      .insert({
        user_id: user.id,
        status: "collected",
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new Error(error?.message || "Erreur création session");
    }

    redirect(`/dashboard/${data.id}`);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                {isAdmin ? "Dashboard administrateur" : "Mes diagnostics"}
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
                {isAdmin
                  ? "Vous pouvez gérer les accès invités, créer un nouveau diagnostic et accéder aux diagnostics réalisés depuis une interface unique."
                  : existingSession
                    ? "Votre diagnostic reste conservé en mémoire. Vous pouvez l’interrompre puis le reprendre sur la même session."
                    : "Vous pouvez créer votre diagnostic. Une fois démarré, il sera conservé et repris sur cette même session."}
              </p>
            </div>

            <div className="flex flex-col gap-3 md:items-end">
              <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Connecté : <span className="font-medium">{user.email ?? user.id}</span>
              </div>

              <div className="flex flex-wrap gap-3 md:justify-end">
                {isAdmin && (
                  <>
                    <Link
                      href="/admin/access"
                      className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                    >
                      Gestion des accès invités
                    </Link>
                    <Link
                      href="/admin/diagnostics"
                      className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                    >
                      Diagnostics réalisés
                    </Link>
                  </>
                )}

                {canCreateNew && (
                  <form action={createSession}>
                    <button className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">
                      Nouveau diagnostic
                    </button>
                  </form>
                )}

                <Link
                  href={logoutHref}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                >
                  Déconnexion
                </Link>
              </div>
            </div>
          </div>
        </section>

        {!isAdmin && existingSession && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-emerald-900">
                  Diagnostic en mémoire
                </div>
                <div className="mt-1 text-sm leading-6 text-emerald-900">
                  Votre diagnostic a déjà été créé. Utilisez uniquement la reprise de session pour continuer.
                </div>
              </div>
              <Link
                href={`/dashboard/${existingSession.id}`}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800"
              >
                Reprendre mon diagnostic
              </Link>
            </div>
          </section>
        )}

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              {isAdmin ? "Vos diagnostics" : "Votre diagnostic"}
            </h2>
            <div className="text-sm text-slate-500">
              {sessions.length} session{sessions.length > 1 ? "s" : ""}
            </div>
          </div>

          {sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              {isAdmin
                ? "Aucun diagnostic n’a encore été créé sur ce compte administrateur."
                : "Aucun diagnostic n’a encore été démarré sur votre accès."}
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div>
                        <div className="text-base font-semibold text-slate-900">
                          {displayFileName(session.source_filename)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Session : {session.id}
                        </div>
                      </div>

                      <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Phase
                          </div>
                          <div className="mt-1 font-medium text-slate-900">
                            {phaseLabel(session.phase)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Statut
                          </div>
                          <div className="mt-1 font-medium text-slate-900">
                            {session.status ?? "n/a"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Créé le
                          </div>
                          <div className="mt-1 font-medium text-slate-900">
                            {formatDateTime(session.created_at)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Mis à jour le
                          </div>
                          <div className="mt-1 font-medium text-slate-900">
                            {formatDateTime(session.updated_at)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 md:justify-end">
                      <Link
                        href={`/dashboard/${session.id}`}
                        className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        Reprendre
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
