"use client";

import { useState } from "react";

type Props = {
  sessionId: string;
};

type IngestResult = {
  ok: boolean;
  source_ref?: string;
  filename?: string | null;
  detected_format?: string | null;
  extracted_length?: number;
  inserted?: number;
  diagnostics_received?: number;
  message?: string;
  error?: string;
};

export default function LegacyKnowledgePanel({ sessionId }: Props) {
  const [sourceRef, setSourceRef] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [sector, setSector] = useState("");
  const [sizeBand, setSizeBand] = useState("");
  const [geography, setGeography] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("session_id", sessionId);
      formData.append("source_ref", sourceRef.trim());
      formData.append("company_name", companyName.trim());
      formData.append("sector", sector.trim());
      formData.append("size_band", sizeBand.trim());
      formData.append("geography", geography.trim());

      if (content.trim()) {
        formData.append("content", content.trim());
      }

      if (file) {
        formData.append("file", file);
      }

      const res = await fetch("/api/diagnostic/ingest-legacy-upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      setResult(json);

      if (!json?.ok) {
        throw new Error(json?.error || "Erreur d’ingestion");
      }

      if (!content.trim()) {
        setFile(null);
      }

      setContent("");
      setSourceRef("");
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
    sourceRef.trim().length > 0 &&
    (content.trim().length > 0 || file !== null);

  return (
    <div className="border rounded p-4 bg-white space-y-4">
      <div>
        <div className="font-semibold text-lg">
          Base de connaissance — anciens diagnostics
        </div>
        <div className="text-sm text-gray-600 mt-1">
          Importez un ancien diagnostic pour enrichir la qualité des constats,
          risques et angles de questionnement du moteur.
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
            Coller le texte du diagnostic
          </div>
          <textarea
            className="border rounded px-3 py-2 w-full min-h-[180px]"
            placeholder="Collez ici le contenu d’un ancien diagnostic..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={loading}
          />
          <div className="text-xs text-gray-500">
            Vous pouvez soit coller le texte, soit charger un fichier.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">
            Ou charger un fichier (.txt, .md, .docx, .pdf)
          </div>
          <input
            type="file"
            accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setFile(selected);
            }}
            disabled={loading}
          />
          {file && (
            <div className="text-sm text-gray-700">
              Fichier sélectionné : <strong>{file.name}</strong>
            </div>
          )}
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
              <div>Source : {result.source_ref || "n/a"}</div>
              <div>Fichier : {result.filename || "texte collé"}</div>
              <div>Format détecté : {result.detected_format || "texte direct"}</div>
              <div>Taille extraite : {result.extracted_length || 0} caractères</div>
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