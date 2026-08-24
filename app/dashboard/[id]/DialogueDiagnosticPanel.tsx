"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type StructuredQuestion = {
  fact_id?: string;
  theme?: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

type SessionState = {
  id: string;
  status?: string;
  phase?: string;
  area?: string;
  area_label?: string;
  dimension?: number | null;
  iteration?: number | null;
  question_index?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

type HistoryEvent = {
  id?: string | number;
  kind?: string;
  payload?: any;
  created_at?: string;
};

type ApiResponse = {
  ok: boolean;
  assistant_message?: string;
  questions?: StructuredQuestion[];
  needs_validation?: boolean;
  session?: SessionState;
  history?: HistoryEvent[];
  error?: string;
};

type DisplayMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
};

type Props = { sessionId: string };

function normalizeQuestions(value: unknown): StructuredQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      fact_id: typeof item.fact_id === "string" ? item.fact_id : undefined,
      theme: typeof item.theme === "string" ? item.theme : undefined,
      constat: String(item.constat ?? "").trim(),
      risque_managerial: String(item.risque_managerial ?? "").trim(),
      question: String(item.question ?? "").trim(),
    }))
    .filter((item) => item.question);
}

function phaseLabel(phase?: string | null) {
  switch (phase) {
    case "area_intake":
      return "Recueil des éléments du domaine";
    case "dimension_iteration":
      return "Questions de diagnostic";
    case "domain_review":
      return "Bilan du domaine à valider";
    case "report_ready":
      return "Entretien terminé";
    default:
      return phase || "Initialisation";
  }
}

function historyToMessages(events: HistoryEvent[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];

  for (const event of events) {
    const kind = String(event.kind ?? "");
    const payload = event.payload ?? {};
    const baseId = String(event.id ?? `${kind}-${out.length}`);

    if (kind === "CHAT_USER") {
      const text = String(payload.message ?? "").trim();
      if (text) out.push({ id: baseId, role: "user", text });
      continue;
    }

    if (kind === "CHAT_ASSISTANT") {
      const text = String(payload.assistant_message ?? "").trim();
      if (text) out.push({ id: baseId, role: "assistant", text });
      continue;
    }

    if (kind === "QUESTION_ANSWER") {
      const questionText = String(payload?.question?.question ?? "").trim();
      const answerText = String(payload.answer ?? "").trim();

      if (questionText) {
        out.push({ id: `${baseId}-q`, role: "assistant", text: questionText });
      }
      if (answerText) {
        out.push({ id: `${baseId}-a`, role: "user", text: answerText });
      }
    }
  }

  return out;
}

export default function DialogueDiagnosticPanel({ sessionId }: Props) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [questions, setQuestions] = useState<StructuredQuestion[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [history, setHistory] = useState<DisplayMessage[]>([]);
  const [needsValidation, setNeedsValidation] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const currentIndex = Math.max(0, Number(session?.question_index ?? 0));
  const currentQuestion = useMemo(
    () => questions[currentIndex] ?? null,
    [questions, currentIndex]
  );

  function applyResponse(data: ApiResponse) {
    setSession(data.session ?? null);
    setQuestions(normalizeQuestions(data.questions));
    setAssistantMessage(String(data.assistant_message ?? "").trim());
    setNeedsValidation(Boolean(data.needs_validation));
    setHistory(historyToMessages(Array.isArray(data.history) ? data.history : []));
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/session/${sessionId}/dialogue-v2`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "Erreur de chargement");
      applyResponse(data);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/session/${sessionId}/dialogue-v2`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "Erreur moteur diagnostic");
      applyResponse(data);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [sessionId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, assistantMessage, currentQuestion, loading]);

  const prompt = currentQuestion?.question || assistantMessage;
  const inputPlaceholder =
    session?.phase === "area_intake"
      ? "Transmettez les éléments disponibles ; indiquez simplement ceux qui ne sont pas suivis..."
      : needsValidation
      ? "Répondez « oui » pour valider, ou indiquez ce que vous souhaitez corriger ou nuancer..."
      : "Votre réponse...";

  const progression =
    session?.phase === "domain_review"
      ? "Synthèse + SWOT — validation"
      : session?.iteration
      ? `Itération ${session.iteration}/3 — Question ${Math.min(
          currentIndex + 1,
          Math.max(questions.length, 1)
        )}/${questions.length || "?"}`
      : session?.phase === "area_intake"
      ? "Recueil initial"
      : "Consolidation";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Étape</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{phaseLabel(session?.phase)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domaine</div>
          <div className="mt-1 text-sm font-medium text-slate-900">
            {session?.area_label || "Contexte — Histoire & résultats"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Progression</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{progression}</div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[520px] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4"
      >
        {history.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-10 whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800"
                : "mr-10 whitespace-pre-line rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-800"
            }
          >
            {message.text}
          </div>
        ))}

        {prompt && (
          <div className="mr-10 whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-900">
            {prompt}
          </div>
        )}

        {loading && <div className="text-sm text-slate-500">Analyse en cours...</div>}
      </div>

      {currentQuestion && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
          {currentQuestion.theme && (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {currentQuestion.theme}
            </div>
          )}
          {currentQuestion.constat && (
            <div><span className="font-semibold">Constat :</span> {currentQuestion.constat}</div>
          )}
          {currentQuestion.risque_managerial && (
            <div><span className="font-semibold">Pourquoi l’éclaircir :</span> {currentQuestion.risque_managerial}</div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {session?.phase === "report_ready" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
          L’entretien de diagnostic est terminé. La consolidation des objectifs et l’édition du rapport seront traitées dans les lots suivants.
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inputPlaceholder}
            rows={4}
            disabled={loading}
            className="min-h-24 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="self-end rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {needsValidation ? "Valider / corriger" : "Envoyer"}
          </button>
        </form>
      )}
    </div>
  );
}
