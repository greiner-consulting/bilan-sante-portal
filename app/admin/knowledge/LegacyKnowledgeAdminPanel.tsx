"use client";

import { useState } from "react";

type IngestResponse = {
  ok: boolean;
  inserted?: number;
  diagnostics_received?: number;
  message?: string;
  error?: string;
};

export default function LegacyKnowledgeAdminPanel() {
  const [sourceRef, setSourceRef] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [sector, setSector] = useState("");
  const [sizeBand, setSizeBand] = useState("");
  const [geography, setGeography] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/diagnostic/ingest-legacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          diagnostics: [
            {
              source_ref: sourceRef.trim(),
              company_name: companyName.trim() || undefined,
              sector: sector.trim() || undefined,
              size_band: sizeBand.trim() || undefined,
              geography: geography.trim() || undefined,
              content: content.trim(),
            },
          ],
        }),
      });

      const json = await res.json();

      if (!json?.ok) {
        throw new Error(json?.error || "Erreur d’ingestion");
      }

      setResult(json);
      setSourceRef("");
      setCompanyName("");
      setSector("");
      setSizeBand("");
      setGeography("");
      setContent("");
    } catch (e: any) {
      setResult({
        ok: false,
        error: e?.message || "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    sourceRef.trim().length > 0 && content.trim().length >= 80;

  return (
    <div className="border rounded p-4 bg-white space-y-4">
      <div>
        <div className="font-semibold text-lg">
          Ingestion d’anciens diagnostics
        </div>
        <div className="text-sm text-gray-600 mt-1">
          Collez ici le texte extrait d’un ancien diagnostic PDF afin
          d’enrichir la base de connaissance du moteur.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <input
            className="border rounded px-3 py-2"
            placeholder="Référence source (obligatoire)"
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            disabled={loading}
          />

          <input
            className="border rounded px-3 py-2"
            placeholder="Nom entreprise"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            disabled={loading}
          />

          <input
            className="border rounded px-3 py-2"
            placeholder="Secteur"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            disabled={loading}
          />

          <input
            className="border rounded px-3 py-2"
            placeholder="Taille / tranche"
            value={sizeBand}
            onChange={(e) => setSizeBand(e.target.value)}
            disabled={loading}
          />

          <input
            className="border rounded px-3 py-2 md:col-span-2"
            placeholder="Géographie"
            value={geography}
            onChange={(e) => setGeography(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">
            Texte de l’ancien diagnostic
          </div>
          <textarea
            className="border rounded px-3 py-2 w-full min-h-[260px]"
            placeholder="Collez ici le texte extrait du PDF..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit || loading}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Ingestion..." : "Ingérer dans la base de connaissance"}
        </button>
      </form>

      {result && (
        <div
          className={[
            "border rounded p-4 text-sm whitespace-pre-line",
            result.ok
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800",
          ].join(" ")}
        >
          {result.ok ? (
            <>
              <div className="font-semibold mb-2">Ingestion réussie</div>
              <div>Diagnostics reçus : {result.diagnostics_received || 0}</div>
              <div>Patterns insérés : {result.inserted || 0}</div>
              <div>{result.message || "Base de connaissance mise à jour."}</div>
            </>
          ) : (
            <>
              <div className="font-semibold mb-2">Échec de l’ingestion</div>
              <div>{result.error || "Erreur inconnue"}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}