"use client";

import { useEffect, useState } from "react";

type Identification = {
  entreprise: string;
  dirigeant: string;
  activite: string;
  localisation: string;
  date: string;
};

type LatestReport = {
  id: string;
  status: string;
  error?: string | null;
  download_url?: string | null;
  identification?: Partial<Identification> | null;
};

type StatusResponse = {
  ok: boolean;
  ready_for_report?: boolean;
  reason?: string | null;
  latest_report?: LatestReport | null;
  identification_defaults?: Partial<Identification>;
  error?: string;
};

export default function ReportBuilderPanel({ sessionId }: { sessionId: string }) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<LatestReport | null>(null);
  const [identification, setIdentification] = useState<Identification>({
    entreprise: "",
    dirigeant: "",
    activite: "",
    localisation: "",
    date: "",
  });

  function mergeIdentification(source?: Partial<Identification> | null) {
    if (!source) return;
    setIdentification((current) => ({
      entreprise: source.entreprise ?? current.entreprise,
      dirigeant: source.dirigeant ?? current.dirigeant,
      activite: source.activite ?? current.activite,
      localisation: source.localisation ?? current.localisation,
      date: source.date ?? current.date,
    }));
  }

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/session/${sessionId}/report-v5`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data = (await res.json()) as StatusResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "Erreur de chargement du rapport");
      setReady(Boolean(data.ready_for_report));
      setLatest(data.latest_report ?? null);
      mergeIdentification(data.identification_defaults);
      mergeIdentification(data.latest_report?.identification);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, [sessionId]);

  function setField(key: keyof Identification, value: string) {
    setIdentification((current) => ({ ...current, [key]: value }));
  }

  const complete =
    identification.entreprise.trim() &&
    identification.dirigeant.trim() &&
    identification.activite.trim() &&
    identification.localisation.trim() &&
    identification.date.trim();

  async function generate() {
    if (!complete || generating) return;
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/session/${sessionId}/report-v5`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identification }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Erreur de génération du rapport");
      setLatest({
        id: data.report_id,
        status: data.status,
        download_url: data.download_url,
        identification,
      });
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setGenerating(false);
    }
  }

  function download() {
    if (latest?.download_url) {
      window.location.href = latest.download_url;
      return;
    }
    loadStatus();
  }

  if (loading && !ready && !latest) return null;
  if (!ready && !latest) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#BFD2E1] bg-white shadow-[0_12px_30px_rgba(23,58,94,0.08)]">
      <div className="h-1.5 bg-[#173A5E]" />
      <div className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3676A8]">
              Étape 7
            </div>
            <h2 className="mt-1 text-xl font-semibold text-[#173A5E]">
              Rapport dirigeant
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66788A]">
              Le rapport Word est construit exclusivement à partir du diagnostic gelé et des
              objectifs validés. Renseignez les éléments d’identification avant de lancer la
              génération.
            </p>
          </div>
          {latest?.status === "ready" && (
            <span className="inline-flex items-center gap-2 rounded-full border border-[#9FD7C5] bg-[#E8F7F1] px-3 py-1.5 text-xs font-semibold text-[#1E6A57]">
              <span className="h-2 w-2 rounded-full bg-[#2D8A72]" />
              Rapport Word prêt
            </span>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-[#D7E3EC] bg-[#F7FAFC] p-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {([
              ["entreprise", "Entreprise"],
              ["dirigeant", "Dirigeant"],
              ["activite", "Activité principale"],
              ["localisation", "Localisation"],
              ["date", "Date du diagnostic"],
            ] as Array<[keyof Identification, string]>).map(([key, label]) => (
              <label key={key} className="space-y-1.5 text-sm xl:col-span-1">
                <span className="font-medium text-[#43566B]">{label}</span>
                <input
                  value={identification[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  className="w-full rounded-lg border border-[#B8CAD9] bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#3676A8] focus:ring-2 focus:ring-[#D9EAF6]"
                />
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          {latest?.status === "ready" && (
            <button
              type="button"
              onClick={download}
              className="rounded-xl border border-[#7FA5C2] bg-white px-5 py-2.5 text-sm font-medium text-[#173A5E] transition hover:bg-[#EFF5F9]"
            >
              Télécharger le rapport Word existant
            </button>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={!complete || generating}
            className="rounded-xl bg-[#173A5E] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#244F77] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating
              ? "Construction du rapport..."
              : latest?.status === "ready"
              ? "Reconstruire le rapport Word"
              : "Construire le rapport Word"}
          </button>
        </div>
      </div>
    </section>
  );
}
