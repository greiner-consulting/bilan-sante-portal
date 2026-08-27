import Link from "next/link";
import { redirect } from "next/navigation";
import { adminSupabase } from "@/lib/supabaseServer";
import PortalPageHeader from "@/app/components/PortalPageHeader";
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
    case "context_intake":
    case "awaiting_trame":
      return "Contexte & résultats";
    case "dimension_questions":
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
      return phase ?? "À démarrer";
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
  const logoutHref = isAdmin ? "/logout?next=/admin/login" : "/logout?next=/login";

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
      .insert({ user_id: user.id, status: "collected" })
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new Error(error?.message || "Erreur création session");
    }

    redirect(`/dashboard/${data.id}`);
  }

  return (
    <main className="min-h-screen bg-[#DCE6EE] px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PortalPageHeader
          pageTitle={isAdmin ? "Dashboard administrateur" : "Mes diagnostics"}
          description={
            isAdmin
              ? "Vous pouvez gérer les accès invités, créer un nouveau diagnostic et accéder aux diagnostics réalisés depuis une interface unique."
              : existingSession
                ? "Votre diagnostic reste conservé en mémoire. Vous pouvez l’interrompre puis le reprendre sur la même session."
                : "Vous pouvez démarrer directement votre diagnostic conversationnel. La session sera conservée pour être reprise à tout moment."
          }
          userLabel="Connecté"
          userValue={user.email ?? user.id}
          actions={
            <>
              {isAdmin && (
                <>
                  <Link href="/admin/access" className="inline-flex items-center justify-center rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]">
                    Gestion des accès invités
                  </Link>
                  <Link href="/admin/diagnostics" className="inline-flex items-center justify-center rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]">
                    Diagnostics réalisés
                  </Link>
                </>
              )}
              {canCreateNew && (
                <form action={createSession}>
                  <button className="inline-flex items-center justify-center rounded-xl bg-[#173A5E] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#214F7B]">
                    Nouveau diagnostic
                  </button>
                </form>
              )}
              <Link href={logoutHref} className="inline-flex items-center justify-center rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]">
                Déconnexion
              </Link>
            </>
          }
        />

        {!isAdmin && existingSession && (
          <section className="rounded-2xl border border-[#9FD6C5] bg-[#E7F6F0] p-5 shadow-[0_8px_24px_rgba(23,58,94,0.06)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-[#1E6654]">Diagnostic en mémoire</div>
                <div className="mt-1 text-sm leading-6 text-[#285E52]">
                  Votre diagnostic a déjà été créé. Utilisez la reprise de session pour continuer exactement là où vous vous êtes arrêté.
                </div>
              </div>
              <Link href={`/dashboard/${existingSession.id}`} className="inline-flex items-center justify-center rounded-xl bg-[#287A65] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#226B58]">
                Reprendre mon diagnostic
              </Link>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-[#B8C9D7] bg-white p-6 shadow-[0_10px_30px_rgba(23,58,94,0.09)]">
          <div className="mb-5 flex items-center justify-between border-b border-[#DFE8EF] pb-4">
            <h2 className="text-lg font-semibold text-[#173A5E]">{isAdmin ? "Vos diagnostics" : "Votre diagnostic"}</h2>
            <div className="rounded-full bg-[#EAF2F8] px-3 py-1 text-sm font-medium text-[#3676A8]">
              {sessions.length} session{sessions.length > 1 ? "s" : ""}
            </div>
          </div>

          {sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#B8C9D7] bg-[#F5F8FA] px-4 py-6 text-sm text-[#66788A]">
              {isAdmin ? "Aucun diagnostic n’a encore été créé sur ce compte administrateur." : "Aucun diagnostic n’a encore été démarré sur votre accès."}
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-[#C9D8E6] bg-[#F5F8FA] p-4 transition hover:border-[#9FB8CC] hover:bg-[#EEF4F8]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div>
                        <div className="text-base font-semibold text-[#173A5E]">Bilan de Santé — Diagnostic dirigeant</div>
                        <div className="mt-1 text-xs text-[#738599]">Session : {session.id}</div>
                      </div>
                      <div className="grid gap-3 text-sm text-[#586B7E] md:grid-cols-2 xl:grid-cols-4">
                        <div><div className="text-xs font-semibold uppercase tracking-wide text-[#6F8498]">Phase</div><div className="mt-1 font-medium text-[#223E58]">{phaseLabel(session.phase)}</div></div>
                        <div><div className="text-xs font-semibold uppercase tracking-wide text-[#6F8498]">Statut</div><div className="mt-1 font-medium text-[#223E58]">{session.status ?? "n/a"}</div></div>
                        <div><div className="text-xs font-semibold uppercase tracking-wide text-[#6F8498]">Créé le</div><div className="mt-1 font-medium text-[#223E58]">{formatDateTime(session.created_at)}</div></div>
                        <div><div className="text-xs font-semibold uppercase tracking-wide text-[#6F8498]">Mis à jour le</div><div className="mt-1 font-medium text-[#223E58]">{formatDateTime(session.updated_at)}</div></div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 md:justify-end">
                      <Link href={`/dashboard/${session.id}`} className="inline-flex items-center justify-center rounded-xl bg-[#173A5E] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#214F7B]">
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
