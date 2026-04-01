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
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
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
      return normalizeText(value) || "—";
  }
}

function statusLabel(value: string | null | undefined): string {
  switch (value) {
    case "in_progress":
      return "En cours";
    case "report_ready":
      return "Rapport prêt";
    case "completed":
      return "Terminée";
    case "failed":
      return "Échec";
    case "collected":
      return "Collectée";
    default:
      return normalizeText(value) || "—";
  }
}

function badgeClass(kind: "phase" | "status" | "ready", value: string): string {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium";

  if (kind === "ready") {
    return value === "yes"
      ? `${base} bg-emerald-100 text-emerald-800`
      : `${base} bg-slate-100 text-slate-700`;
  }

  if (value === "report_ready" || value === "completed") {
    return `${base} bg-emerald-100 text-emerald-800`;
  }

  if (value === "failed") {
    return `${base} bg-red-100 text-red-800`;
  }

  if (value === "final_objectives_validation" || value === "iteration_validation") {
    return `${base} bg-amber-100 text-amber-800`;
  }

  return `${base} bg-slate-100 text-slate-700`;
}

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
      const res = await fetch("/api/admin/diagnostics/list", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data: DiagnosticsListResponse = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Impossible de charger les diagnostics.");
      }

      setRows(Array.isArray(data.diagnostics) ? data.diagnostics : []);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const phaseOptions = useMemo(() => {
    const values = Array.from(
      new Set(rows.map((row) => normalizeText(row.phase)).filter(Boolean))
    );
    return values.sort((a, b) => a.localeCompare(b, "fr"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = normalizeText(search).toLowerCase();

    return rows.filter((row) => {
      if (row.deleted_at) return false;

      if (phaseFilter !== "all" && normalizeText(row.phase) !== phaseFilter) {
        return false;
      }

      if (readyOnly && !row.final_report_ready) {
        return false;
      }

      if (!query) return true;

      const haystack = [
        row.id,
        row.source_filename,
        row.phase,
        row.status,
        row.user_id,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }, [rows, search, phaseFilter, readyOnly]);

  async function handleDelete(id: string) {
    const confirmed = window.confirm(
      "Confirmez-vous la suppression de ce diagnostic ? Il sera masqué des vues standard."
    );
    if (!confirmed) return;

    setLoadingActionId(id);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(`/api/admin/diagnostics/${id}/delete`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Impossible de supprimer ce diagnostic.");
      }

      setMessage(data.message || "Diagnostic supprimé.");
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue.");
    } finally {
      setLoadingActionId(null);
    }
  }

  function openView(id: string) {
    window.location.href = `/dashboard/${id}`;
  }

  function triggerDownload(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-1 md:col-span-2 xl:col-span-2">
            <label className="text-sm font-medium text-slate-900">Recherche</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="text"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              placeholder="Entreprise, session, phase, statut..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-900">Phase</label>
            <select
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="all">Toutes les phases</option>
              {phaseOptions.map((phase) => (
                <option key={phase} value={phase}>
                  {phaseLabel(phase)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                checked={readyOnly}
                onChange={(e) => setReadyOnly(e.target.checked)}
                type="checkbox"
              />
              Rapports prêts uniquement
            </label>
            <button
              type="button"
              onClick={loadData}
              disabled={refreshing}
              className="rounded-xl border px-4 py-2.5 text-sm font-medium text-slate-700"
            >
              {refreshing ? "Actualisation..." : "Actualiser"}
            </button>
          </div>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Liste des diagnostics</h2>
          <div className="text-sm text-slate-500">
            {filteredRows.length} diagnostic{filteredRows.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border bg-slate-50 px-3 py-2 text-left">Entreprise / trame</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Session</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Phase</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Statut</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Créé le</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Mis à jour le</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Rapport</th>
                <th className="border bg-slate-50 px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="border px-3 py-3 text-slate-500" colSpan={8}>
                    Aucun diagnostic visible avec les filtres actuels.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isBusy = loadingActionId === row.id;

                  return (
                    <tr key={row.id}>
                      <td className="border px-3 py-2 align-top">
                        <div className="font-medium text-slate-900">
                          {normalizeText(row.source_filename) || "Trame non renseignée"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Utilisateur : {normalizeText(row.user_id) || "—"}
                        </div>
                      </td>
                      <td className="border px-3 py-2 align-top font-mono text-xs text-slate-700">
                        {row.id}
                      </td>
                      <td className="border px-3 py-2 align-top">
                        <span className={badgeClass("phase", normalizeText(row.phase))}>
                          {phaseLabel(row.phase)}
                        </span>
                      </td>
                      <td className="border px-3 py-2 align-top">
                        <span className={badgeClass("status", normalizeText(row.status))}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="border px-3 py-2 align-top text-slate-700">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="border px-3 py-2 align-top text-slate-700">
                        {formatDateTime(row.updated_at)}
                      </td>
                      <td className="border px-3 py-2 align-top">
                        <span className={badgeClass("ready", row.final_report_ready ? "yes" : "no")}>
                          {row.final_report_ready ? "Prêt" : "Non prêt"}
                        </span>
                      </td>
                      <td className="border px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openView(row.id)}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            Voir
                          </button>
                          <button
                            type="button"
                            onClick={() => triggerDownload(`/api/admin/diagnostics/${row.id}/pdf`)}
                            disabled={!row.final_report_ready}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => triggerDownload(`/api/admin/diagnostics/${row.id}/docx`)}
                            disabled={!row.final_report_ready}
                            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                          >
                            DOCX
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id)}
                            disabled={isBusy}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                          >
                            {isBusy ? "Suppression..." : "Supprimer"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
