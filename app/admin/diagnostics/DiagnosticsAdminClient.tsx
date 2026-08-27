"use client";

import { useEffect, useMemo, useState } from "react";

type DiagnosticAdminRow = {
  id: string;
  user_id: string | null;
  source_filename: string | null;
  status: string | null;
  phase: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  final_report_ready: boolean;
};

type DiagnosticsListResponse = {
  ok: boolean;
  diagnostics: DiagnosticAdminRow[];
  error?: string;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function phaseLabel(value: string | null | undefined): string {
  switch (value) {
    case "awaiting_trame":
      return "Contexte & résultats";
    case "structured_intake":
      return "Saisie des données";
    case "area_intake":
      return "Contexte et explications";
    case "dimension_iteration":
    case "dimension_questions":
      return "Questions en cours";
    case "domain_review":
      return "Bilan du domaine";
    case "iteration_validation":
      return "Validation d’itération";
    case "objectives_review":
    case "final_objectives_validation":
      return "Validation des objectifs";
    case "report_ready":
      return "Rapport prêt";
    case "completed":
      return "Terminée";
    default:
      return normalizeText(value) || "—";
  }
}

function statusLabel(value: string | null | undefined): string {
  switch (value) {
    case "in_progress": return "En cours";
    case "report_ready": return "Rapport prêt";
    case "completed": return "Terminée";
    case "failed": return "Échec";
    case "collected": return "Collectée";
    default: return normalizeText(value) || "—";
  }
}

function badgeClass(kind: "phase" | "status" | "ready", value: string): string {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold";
  if (kind === "ready") return value === "yes" ? `${base} bg-[#DDF4EB] text-[#1E6654]` : `${base} bg-[#EEF3F7] text-[#5F7182]`;
  if (value === "report_ready" || value === "completed") return `${base} bg-[#DDF4EB] text-[#1E6654]`;
  if (value === "failed") return `${base} bg-red-100 text-red-800`;
  if (value === "final_objectives_validation" || value === "iteration_validation" || value === "objectives_review") return `${base} bg-[#FFF1D9] text-[#95621F]`;
  return `${base} bg-[#EAF2F8] text-[#315F83]`;
}

const cardClass = "rounded-2xl border border-[#B8C9D7] bg-white p-6 shadow-[0_10px_30px_rgba(23,58,94,0.09)]";
const fieldClass = "w-full rounded-xl border border-[#B8C9D7] bg-[#F8FBFD] px-3 py-2.5 text-sm text-[#223E58] outline-none transition focus:border-[#3676A8] focus:bg-white focus:ring-2 focus:ring-[#DCEAF5]";
const thClass = "border border-[#B8C9D7] bg-[#DDEAF3] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[#173A5E]";
const tdClass = "border border-[#CDD9E2] px-3 py-2.5 align-top text-[#43566B]";

export default function DiagnosticsAdminClient() {
  const [rows, setRows] = useState<DiagnosticAdminRow[]>([]);
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [readyOnly, setReadyOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/diagnostics/list", { method: "GET", credentials: "include", cache: "no-store" });
      const data: DiagnosticsListResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "Impossible de charger les diagnostics.");
      setRows(Array.isArray(data.diagnostics) ? data.diagnostics : []);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const phaseOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((row) => normalizeText(row.phase)).filter(Boolean)));
    return values.sort((a, b) => a.localeCompare(b, "fr"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = normalizeText(search).toLowerCase();
    return rows.filter((row) => {
      if (row.deleted_at) return false;
      if (phaseFilter !== "all" && normalizeText(row.phase) !== phaseFilter) return false;
      if (readyOnly && !row.final_report_ready) return false;
      if (!query) return true;
      const haystack = [row.id, row.source_filename, row.phase, row.status, row.user_id]
        .map((item) => normalizeText(item).toLowerCase()).join(" ");
      return haystack.includes(query);
    });
  }, [rows, search, phaseFilter, readyOnly]);

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Confirmez-vous la suppression de ce diagnostic ? Il sera masqué des vues standard.");
    if (!confirmed) return;
    setLoadingActionId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/diagnostics/${id}/delete`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Impossible de supprimer ce diagnostic.");
      setMessage(data.message || "Diagnostic supprimé.");
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setLoadingActionId(null);
    }
  }

  function openView(id: string) { window.location.href = `/dashboard/${id}`; }
  function triggerDownload(url: string) { window.open(url, "_blank", "noopener,noreferrer"); }

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-1 md:col-span-2 xl:col-span-2">
            <label className="text-sm font-medium text-[#294762]">Recherche</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" className={fieldClass} placeholder="Entreprise, session, phase, statut..." />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-[#294762]">Phase</label>
            <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} className={fieldClass}>
              <option value="all">Toutes les phases</option>
              {phaseOptions.map((phase) => <option key={phase} value={phase}>{phaseLabel(phase)}</option>)}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-3 text-sm text-[#43566B]"><input checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} type="checkbox" /> Rapports prêts uniquement</label>
            <button type="button" onClick={loadData} disabled={refreshing} className="rounded-xl border border-[#B8C9D7] bg-white px-4 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EAF2F8]">
              {refreshing ? "Actualisation..." : "Actualiser"}
            </button>
          </div>
        </div>
        {message ? <div className="mt-4 rounded-xl border border-[#9FD6C5] bg-[#E7F6F0] p-3 text-sm text-[#1E6654]">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      </section>

      <section className={cardClass}>
        <div className="flex items-center justify-between gap-4 border-b border-[#DFE8EF] pb-4">
          <h2 className="text-lg font-semibold text-[#173A5E]">Liste des diagnostics</h2>
          <div className="rounded-full bg-[#EAF2F8] px-3 py-1 text-sm font-medium text-[#3676A8]">{filteredRows.length} diagnostic{filteredRows.length > 1 ? "s" : ""}</div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-[#B8C9D7]">
          <table className="min-w-full border-collapse text-sm">
            <thead><tr><th className={thClass}>Diagnostic</th><th className={thClass}>Session</th><th className={thClass}>Phase</th><th className={thClass}>Statut</th><th className={thClass}>Créé le</th><th className={thClass}>Mis à jour le</th><th className={thClass}>Rapport</th><th className={thClass}>Actions</th></tr></thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td className={`${tdClass} bg-white text-[#66788A]`} colSpan={8}>Aucun diagnostic visible avec les filtres actuels.</td></tr>
              ) : filteredRows.map((row, index) => {
                const isBusy = loadingActionId === row.id;
                return (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#F7FAFC]"}>
                    <td className={tdClass}><div className="font-semibold text-[#173A5E]">Bilan de Santé — Diagnostic dirigeant</div><div className="mt-1 text-xs text-[#738599]">Utilisateur : {normalizeText(row.user_id) || "—"}</div></td>
                    <td className={`${tdClass} font-mono text-xs text-[#51677A]`}>{row.id}</td>
                    <td className={tdClass}><span className={badgeClass("phase", normalizeText(row.phase))}>{phaseLabel(row.phase)}</span></td>
                    <td className={tdClass}><span className={badgeClass("status", normalizeText(row.status))}>{statusLabel(row.status)}</span></td>
                    <td className={tdClass}>{formatDateTime(row.created_at)}</td>
                    <td className={tdClass}>{formatDateTime(row.updated_at)}</td>
                    <td className={tdClass}><span className={badgeClass("ready", row.final_report_ready ? "yes" : "no")}>{row.final_report_ready ? "Prêt" : "Non prêt"}</span></td>
                    <td className={tdClass}>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => openView(row.id)} className="rounded-lg bg-[#173A5E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#214F7B]">Voir</button>
                        <button type="button" onClick={() => triggerDownload(`/api/admin/diagnostics/${row.id}/pdf`)} disabled={!row.final_report_ready} className="rounded-lg border border-[#B8C9D7] bg-white px-3 py-1.5 text-xs font-medium text-[#315F83] hover:bg-[#EAF2F8] disabled:opacity-40">PDF</button>
                        <button type="button" onClick={() => triggerDownload(`/api/admin/diagnostics/${row.id}/docx`)} disabled={!row.final_report_ready} className="rounded-lg border border-[#B8C9D7] bg-white px-3 py-1.5 text-xs font-medium text-[#315F83] hover:bg-[#EAF2F8] disabled:opacity-40">DOCX</button>
                        <button type="button" onClick={() => handleDelete(row.id)} disabled={isBusy} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{isBusy ? "Suppression..." : "Supprimer"}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
