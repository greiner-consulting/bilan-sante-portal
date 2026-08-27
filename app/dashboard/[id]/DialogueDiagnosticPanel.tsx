"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type StructuredQuestion = {
  fact_id?: string;
  theme?: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

type IntakeColumn = {
  key: string;
  label: string;
  kind: "text" | "number";
  unit?: string;
  placeholder?: string;
};

type IntakeTable = {
  key: string;
  title: string;
  description?: string;
  columns: IntakeColumn[];
  rows: Array<Record<string, string>>;
};

type IntakeField = {
  key: string;
  label: string;
  kind: "text" | "number";
  unit?: string;
  placeholder?: string;
};

type IntakeSchema = {
  area: string;
  title: string;
  instructions: string;
  note?: string;
  tables: IntakeTable[];
  fields?: IntakeField[];
};

type IntakeData = {
  tables: Record<string, Array<Record<string, string>>>;
  fields: Record<string, string>;
};

type SessionState = {
  id: string;
  status?: string;
  phase?: string;
  area?: string;
  area_label?: string;
  dimension?: number | null;
  iteration?: number | null;
  max_iterations?: number | null;
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
  intake_schema?: IntakeSchema | null;
  intake_data?: IntakeData | null;
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
    case "structured_intake":
      return "Saisie des données chiffrées";
    case "area_intake":
      return "Contexte et explications";
    case "dimension_iteration":
      return "Questions de diagnostic";
    case "domain_review":
      return "Bilan du domaine à valider";
    case "objectives_review":
      return "Consolidation du diagnostic";
    case "report_ready":
      return "Diagnostic consolidé";
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

    if (kind === "STRUCTURED_INTAKE") {
      const text = String(payload.display_text ?? "").trim();
      if (text) out.push({ id: baseId, role: "user", text });
      continue;
    }

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

      if (questionText) out.push({ id: `${baseId}-q`, role: "assistant", text: questionText });
      if (answerText) out.push({ id: `${baseId}-a`, role: "user", text: answerText });
    }
  }

  return out;
}

function cloneIntakeData(data: IntakeData | null | undefined): IntakeData {
  return {
    tables: Object.fromEntries(
      Object.entries(data?.tables ?? {}).map(([key, rows]) => [
        key,
        rows.map((row) => ({ ...row })),
      ])
    ),
    fields: { ...(data?.fields ?? {}) },
  };
}

export default function DialogueDiagnosticPanel({ sessionId }: Props) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [questions, setQuestions] = useState<StructuredQuestion[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [history, setHistory] = useState<DisplayMessage[]>([]);
  const [needsValidation, setNeedsValidation] = useState(false);
  const [intakeSchema, setIntakeSchema] = useState<IntakeSchema | null>(null);
  const [intakeData, setIntakeData] = useState<IntakeData>({ tables: {}, fields: {} });
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
    setIntakeSchema(data.intake_schema ?? null);
    setIntakeData(cloneIntakeData(data.intake_data));
    setHistory(historyToMessages(Array.isArray(data.history) ? data.history : []));
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/session/${sessionId}/dialogue-v5`, {
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
      const res = await fetch(`/api/session/${sessionId}/dialogue-v5`, {
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

  async function submitStructuredIntake() {
    if (!intakeSchema || loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/dialogue-v5`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structured_data: intakeData }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) {
        if (data.error === "STRUCTURED_INTAKE_EMPTY") {
          throw new Error("Renseignez au moins une donnée chiffrée ou une valeur avant de continuer.");
        }
        throw new Error(data.error || "Erreur d’enregistrement des données");
      }
      applyResponse(data);
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  function setTableValue(tableKey: string, rowIndex: number, columnKey: string, value: string) {
    setIntakeData((current) => {
      const next = cloneIntakeData(current);
      const rows = next.tables[tableKey] ?? [];
      const row = { ...(rows[rowIndex] ?? {}) };
      row[columnKey] = value;
      rows[rowIndex] = row;
      next.tables[tableKey] = rows;
      return next;
    });
  }

  function setFieldValue(fieldKey: string, value: string) {
    setIntakeData((current) => ({
      ...current,
      fields: { ...current.fields, [fieldKey]: value },
    }));
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
      ? session?.area === "context"
        ? "Que s’est-il passé ? Quelle est votre histoire et votre impression sur ces trois dernières années ?"
        : "Expliquez les éléments de contexte et de fonctionnement qui permettent de comprendre la situation..."
      : session?.phase === "objectives_review"
      ? "Indiquez vos priorités, les objectifs à supprimer, reformuler ou ajouter ; ou répondez « oui » pour valider..."
      : needsValidation
      ? "Répondez « oui » pour valider, ou indiquez ce que vous souhaitez corriger ou nuancer..."
      : "Votre réponse...";

  const maxIterations = Math.max(1, Number(session?.max_iterations ?? 3));
  const progression =
    session?.phase === "structured_intake"
      ? "Étape 1 — Données chiffrées"
      : session?.phase === "area_intake"
      ? "Étape 2 — Contexte et explications"
      : session?.phase === "domain_review"
      ? "Synthèse + SWOT — validation"
      : session?.phase === "objectives_review"
      ? "Définition des objectifs de résultat"
      : session?.phase === "report_ready"
      ? "Objectifs validés — rapport à construire"
      : session?.iteration
      ? maxIterations === 1
        ? `Échange historique — Question ${Math.min(currentIndex + 1, Math.max(questions.length, 1))}/${questions.length || "?"}`
        : `Itération ${session.iteration}/${maxIterations} — Question ${Math.min(
            currentIndex + 1,
            Math.max(questions.length, 1)
          )}/${questions.length || "?"}`
      : "Consolidation";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["Étape", phaseLabel(session?.phase)],
          ["Domaine", session?.area_label || "Contexte — Histoire & résultats"],
          ["Progression", progression],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#C9D8E6] bg-[#F5F9FC] p-3 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7F93]">{label}</div>
            <div className="mt-1 text-sm font-semibold text-[#173A5E]">{value}</div>
          </div>
        ))}
      </div>

      {session?.phase === "structured_intake" && intakeSchema ? (
        <div className="space-y-5 rounded-xl border border-[#C9D8E6] bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-base font-semibold text-[#173A5E]">{intakeSchema.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[#43566B]">{intakeSchema.instructions}</p>
            {intakeSchema.note && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                {intakeSchema.note}
              </p>
            )}
          </div>

          {intakeSchema.tables.map((table) => (
            <div key={table.key} className="space-y-2">
              <div className="text-sm font-semibold text-[#173A5E]">{table.title}</div>
              <div className="overflow-x-auto rounded-lg border border-[#D6E2EC]">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-[#EAF2F8]">
                    <tr>
                      {table.columns.map((column) => (
                        <th
                          key={column.key}
                          className="whitespace-nowrap border-b border-r border-[#D6E2EC] px-3 py-2 text-left text-xs font-semibold text-[#45637C] last:border-r-0"
                        >
                          {column.label}{column.unit ? ` (${column.unit})` : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(intakeData.tables[table.key] ?? table.rows).map((row, rowIndex) => (
                      <tr key={rowIndex} className="bg-white">
                        {table.columns.map((column) => (
                          <td key={column.key} className="border-b border-r border-[#E1EAF1] p-1 last:border-r-0">
                            <input
                              type="text"
                              inputMode={column.kind === "number" ? "decimal" : undefined}
                              value={String(row?.[column.key] ?? "")}
                              onChange={(e) => setTableValue(table.key, rowIndex, column.key, e.target.value)}
                              placeholder={column.placeholder || ""}
                              disabled={loading}
                              className="w-full min-w-24 rounded-md border border-transparent px-2 py-2 text-sm text-slate-900 outline-none transition focus:border-[#7DA5C3] focus:bg-[#F5F9FC]"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {(intakeSchema.fields || []).length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(intakeSchema.fields || []).map((field) => (
                <label key={field.key} className="space-y-1 text-sm">
                  <span className="font-medium text-[#43566B]">
                    {field.label}{field.unit ? ` (${field.unit})` : ""}
                  </span>
                  <input
                    type="text"
                    inputMode={field.kind === "number" ? "decimal" : undefined}
                    value={intakeData.fields[field.key] ?? ""}
                    onChange={(e) => setFieldValue(field.key, e.target.value)}
                    placeholder={field.placeholder || ""}
                    disabled={loading}
                    className="w-full rounded-lg border border-[#B8CAD9] px-3 py-2 text-sm text-slate-900 focus:border-[#3676A8] focus:outline-none focus:ring-2 focus:ring-[#D9EAF6]"
                  />
                </label>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitStructuredIntake}
              disabled={loading}
              className="rounded-xl bg-[#173A5E] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#244F77] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Enregistrement..." : "Valider les données et continuer"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="max-h-[520px] space-y-3 overflow-y-auto rounded-xl border border-[#D6E2EC] bg-[#F8FBFD] p-4">
            {history.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-10 whitespace-pre-line rounded-xl border border-[#D9E2EA] bg-white p-3 text-sm leading-6 text-[#30465B] shadow-sm"
                    : "mr-10 whitespace-pre-line rounded-xl border border-[#C8DDEB] bg-[#EAF2F8] p-3 text-sm leading-6 text-[#294762] shadow-sm"
                }
              >
                {message.text}
              </div>
            ))}

            {prompt && (
              <div className="mr-10 whitespace-pre-line rounded-xl border border-[#AFC9DC] bg-[#E3EFF7] p-4 text-sm leading-6 text-[#173A5E] shadow-sm">
                {prompt}
              </div>
            )}

            {loading && <div className="text-sm font-medium text-[#6B7F93]">Analyse en cours...</div>}
          </div>

          {currentQuestion && (
            <div className="space-y-3 rounded-xl border border-[#D8C38D] bg-[#FFF9E8] p-4 text-sm leading-6 text-[#5A4A25]">
              {currentQuestion.theme && (
                <div className="text-xs font-semibold uppercase tracking-wide text-[#9B6B14]">{currentQuestion.theme}</div>
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
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {session?.phase === "report_ready" ? (
            <div className="rounded-xl border border-[#9FD7C5] bg-[#E8F7F1] p-4 text-sm font-medium leading-6 text-[#1E6A57]">
              Les objectifs de résultat sont validés. Le diagnostic est consolidé. L’étape suivante sera la construction du rapport dirigeant.
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
                className="min-h-24 flex-1 resize-y rounded-xl border border-[#B8CAD9] bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#3676A8] focus:outline-none focus:ring-2 focus:ring-[#D9EAF6] disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="self-end rounded-xl bg-[#173A5E] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#244F77] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {session?.phase === "objectives_review"
                  ? "Valider / ajuster"
                  : needsValidation
                  ? "Valider / corriger"
                  : "Envoyer"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
