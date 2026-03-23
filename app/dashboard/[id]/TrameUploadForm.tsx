"use client";

import { useRef, useState } from "react";

type Props = {
  sessionId: string;
};

type UploadState =
  | { type: "idle"; message: "" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

type StartDiagnosticResponse = {
  ok: boolean;
  session_id?: string;
  phase?: string;
  error?: string;
};

export default function TrameUploadForm({ sessionId }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<UploadState>({
    type: "idle",
    message: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!file) {
      setState({
        type: "error",
        message: "Veuillez sélectionner un fichier .docx.",
      });
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".docx")) {
      setState({
        type: "error",
        message: "Seuls les fichiers .docx sont acceptés.",
      });
      return;
    }

    setLoading(true);
    setState({ type: "idle", message: "" });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("session_id", sessionId);

      const res = await fetch("/api/diagnostic/start", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const result: StartDiagnosticResponse = await res.json();

      if (!result.ok) {
        throw new Error(result.error || "Échec du chargement de la trame.");
      }

      setState({
        type: "success",
        message:
          "Trame uploadée et ingérée avec succès. Le protocole peut maintenant démarrer.",
      });

      setFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      window.dispatchEvent(
        new CustomEvent("bilan-trame-ingested", {
          detail: {
            sessionId,
            phase: result.phase ?? null,
          },
        })
      );
    } catch (e: any) {
      setState({
        type: "error",
        message: e?.message || "Erreur inconnue lors du chargement.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null;
          setFile(selected);
          setState({ type: "idle", message: "" });
        }}
        disabled={loading}
      />

      <div>
        <button
          type="submit"
          disabled={loading}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Upload et ingestion..." : "Charger la trame"}
        </button>
      </div>

      {state.type === "success" && (
        <div className="text-sm text-green-700">{state.message}</div>
      )}

      {state.type === "error" && (
        <div className="text-sm text-red-700">{state.message}</div>
      )}
    </form>
  );
}