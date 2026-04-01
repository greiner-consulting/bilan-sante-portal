import Link from "next/link";
import { redirect } from "next/navigation";
import DeleteDiagnosticButton from "./DeleteDiagnosticButton";
import { requireEntitledUser, isAdminUser } from "@/lib/auth/access-control";
import { adminSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  source_filename: string | null;
  status: string | null;
  phase: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

function formatDateTime(value: string | null | undefined): string {
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

function phaseLabel(value: string | null | undefined): string {
  switch (value) {
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
      return value || "—";
  }
}

function statusLabel(value: string | null | undefined): string {
  switch (value) {
    case "collected":
      return "Créée";
    case "in_progress":
      return "En cours";
    case "report_ready":
      return "Rapport prêt";
    case "completed":
      return "Terminée";
    case "failed":
      return "Échec";
    case "deleted":
      return "Supprimée";
    default:
      return value || "—";
  }
}

function displayFileName(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "Diagnostic sans trame nommée";
}

async function listUserSessions(userId: string): Promise<SessionRow[]> {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("diagnostic_sessions")
    .select("id, source_filename, status, phase, created_at, updated_at, deleted_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`SESSION_LIST_FAILED: ${error.message}`);
  }

  return Array.isArray(data) ? (data as SessionRow[]) : [];
}

export default async function DashboardPage() {
  const user = await requireEntitledUser();
  const [sessions, admin] = await Promise.all([
    listUserSessions(user.id),
    isAdminUser(user.id),
  ]);

  async function createSession() {
    "use server";

    const currentUser = await requireEntitledUser();
    const adminClient = adminSupabase();
    const { data, error } = await adminClient
      .from("diagnostic_sessions")
      .insert({
        user_id: currentUser.id,
        status: "collected",
        phase: "awaiting_trame",
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
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Mes diagnostics</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
                Reprenez un diagnostic existant, supprimez une session devenue inutile
                ou créez une nouvelle session de Bilan de Santé.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {admin ? (
                <Link
                  href="/admin/diagnostics"
                  className="rounded-xl border px-4 py-2.5 text-sm font-medium text-slate-700"
                >
                  Administration diagnostics
                </Link>
              ) : null}
              <form action={createSession}>
                <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white">
                  Nouveau diagnostic
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900">Diagnostics stockés</h2>
            <div className="text-sm text-slate-500">{sessions.length} session(s)</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border bg-slate-50 px-3 py-2 text-left">Entreprise / trame</th>
                  <th className="border bg-slate-50 px-3 py-2 text-left">Phase</th>
                  <th className="border bg-slate-50 px-3 py-2 text-left">Statut</th>
                  <th className="border bg-slate-50 px-3 py-2 text-left">Créé le</th>
                  <th className="border bg-slate-50 px-3 py-2 text-left">Mis à jour le</th>
                  <th className="border bg-slate-50 px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td className="border px-3 py-4 text-slate-500" colSpan={6}>
                      Aucun diagnostic disponible pour le moment.
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr key={session.id}>
                      <td className="border px-3 py-2.5">
                        <div className="font-medium text-slate-900">
                          {displayFileName(session.source_filename)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Session : {session.id}</div>
                      </td>
                      <td className="border px-3 py-2.5 text-slate-700">
                        {phaseLabel(session.phase)}
                      </td>
                      <td className="border px-3 py-2.5 text-slate-700">
                        {statusLabel(session.status)}
                      </td>
                      <td className="border px-3 py-2.5 text-slate-700">
                        {formatDateTime(session.created_at)}
                      </td>
                      <td className="border px-3 py-2.5 text-slate-700">
                        {formatDateTime(session.updated_at)}
                      </td>
                      <td className="border px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/dashboard/${session.id}`}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            Reprendre
                          </Link>
                          <DeleteDiagnosticButton sessionId={session.id} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
