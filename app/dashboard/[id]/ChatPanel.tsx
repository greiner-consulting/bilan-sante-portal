"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type StructuredQuestion = {
  fact_id?: string;
  theme?: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

type FinalObjective = {
  id: string;
  dimensionId: string | number;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: "proposed" | "validated" | "adjusted" | "refused";
  quickWin: string;
};

type FinalObjectiveSet = {
  header: string;
  objectives: FinalObjective[];
  decisionsCapturedAt?: string;
};

type FrozenDimension = {
  dimensionId: number;
  score: number;
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
  unmanagedZones: Array<{
    constat: string;
    risqueManagerial: string;
    consequence: string;
  }>;
  frozenAt: string;
};

type PersistedTurn = {
  id: string;
  createdAt?: string;
  role: "assistant" | "user" | "question" | "system";
  text: string;
  kind?: string | null;
  phase?: string | null;
  dimensionId?: number | null;
  iteration?: number | null;
  questionId?: string | null;
  signalId?: string | null;
  theme?: string | null;
  ordinal?: number | null;
  total?: number | null;
};

type PreviewSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  tables?: Array<{
    title?: string;
    headers: string[];
    rows: string[][];
  }>;
};

type PreviewDiagnosticReport = {
  title: string;
  generatedAt: string;
  sections: PreviewSection[];
};

type DisplayMessage =
  | { role: "assistant" | "user" | "system"; text: string; key: string }
  | {
      role: "question";
      text: string;
      theme?: string;
      dimension?: number | null;
      iteration?: number | null;
      ordinal?: number | null;
      total?: number | null;
      key: string;
    };

type SessionState = {
  id: string;
  user_id?: string;
  status?: string;
  phase?: string;
  dimension?: number | null;
  iteration?: number | null;
  question_index?: number;
  trame_pdf_path?: string | null;
  has_trame_index?: boolean;
  has_extracted_text?: boolean;
};

type AssistantResponse = {
  assistant_message: string;
  questions: StructuredQuestion[];
  needs_validation: boolean;
  session?: SessionState;
};

type AnswerApiResponse = {
  ok: boolean;
  assistant_message?: string;
  questions?: StructuredQuestion[];
  needs_validation?: boolean;
  session?: SessionState;
  assistant?: AssistantResponse;
  error?: string;
};

type ContextApiResponse = {
  ok: boolean;
  session?: SessionState;
  engine_state?: {
    question_batch_json?: StructuredQuestion[];
    final_objectives_json?: FinalObjectiveSet | null;
    consolidation_json?: FrozenDimension[];
    conversation_history_json?: PersistedTurn[];
    bilan_state_json?: unknown;
  };
  error?: string;
};

type BuildReportApiResponse = {
  ok: boolean;
  preview?: PreviewDiagnosticReport;
  html?: string;
  docxBase64?: string;
  docxFileName?: string;
  compliance?: { ok: boolean; warnings?: Array<{ code?: string; message?: string } | string>; summary?: string[] };
  blocking_issues?: Array<{ code?: string; message?: string }>;
  warnings?: Array<{ code?: string; message?: string }>;
  summary?: string[];
  error?: string;
};

type Props = { sessionId: string };

function initialAssistantMessage() {
  return "Le diagnostic démarrera automatiquement dès qu’une trame exploitable sera disponible.";
}

function clampIndex(index: number, total: number) {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(index, total - 1));
}

function normalizeQuestions(value: unknown): StructuredQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Partial<StructuredQuestion>;
      return {
        fact_id: typeof row.fact_id === "string" ? row.fact_id : undefined,
        theme: typeof row.theme === "string" ? row.theme : undefined,
        constat: String(row.constat ?? "").trim(),
        risque_managerial: String(row.risque_managerial ?? "").trim(),
        question: String(row.question ?? "").trim(),
      };
    })
    .filter((item) => Boolean(item.constat) && Boolean(item.risque_managerial) && Boolean(item.question));
}

function mergeSessionState(current: SessionState | null, next?: SessionState | null, fallbackId?: string): SessionState | null {
  if (!current && !next && !fallbackId) return null;
  return {
    ...(current ?? { id: fallbackId ?? "" }),
    ...(next ?? {}),
    id: String(next?.id ?? current?.id ?? fallbackId ?? "").trim(),
  };
}

function normalizeAssistantResponse(data: AnswerApiResponse): AssistantResponse | null {
  if (data.assistant) {
    return {
      assistant_message: String(data.assistant.assistant_message ?? "").trim(),
      questions: normalizeQuestions(data.assistant.questions),
      needs_validation: Boolean(data.assistant.needs_validation),
      session: data.assistant.session,
    };
  }

  if (typeof data.assistant_message !== "undefined" || typeof data.questions !== "undefined" || typeof data.needs_validation !== "undefined") {
    return {
      assistant_message: String(data.assistant_message ?? "").trim(),
      questions: normalizeQuestions(data.questions),
      needs_validation: Boolean(data.needs_validation),
      session: data.session,
    };
  }

  return null;
}

function phaseLabel(phase?: string | null) {
  switch (phase) {
    case "awaiting_trame":
      return "En attente de trame";
    case "dimension_iteration":
      return "Questions en cours";
    case "iteration_validation":
      return "Validation d’itération";
    case "final_objectives_validation":
      return "Validation des objectifs";
    case "report_ready":
      return "Rapport prêt à construire";
    case "completed":
      return "Terminée";
    default:
      return phase ?? "n/a";
  }
}

function dimensionLabel(dimension?: number | string | null) {
  switch (Number(dimension)) {
    case 1:
      return "1 — Organisation & RH";
    case 2:
      return "2 — Commercial & Marchés";
    case 3:
      return "3 — Cycle de vente & Prix";
    case 4:
      return "4 — Exécution & Performance opérationnelle";
    default:
      return "n/a";
  }
}

function iterationLabel(iteration?: number | null) {
  if (!iteration) return "n/a";
  return `${iteration}/3`;
}

function buildPlaceholder(params: { currentQuestion: StructuredQuestion | null; awaitingValidation: boolean; phase?: string | null }) {
  if (params.phase === "final_objectives_validation") {
    return 'Exemple : 1: validé | 2: refusé | 3: ajusté | objectif=... | indicateur=...';
  }
  if (params.currentQuestion) return "Votre réponse à la question affichée...";
  if (params.awaitingValidation) return 'Répondez "oui" ou "non"...';
  if (params.phase === "report_ready") return "Le protocole est terminé. Vous pouvez construire le rapport.";
  return "Votre réponse...";
}

function buildMessagesFromHistory(turns: PersistedTurn[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  for (const turn of turns) {
    const text = String(turn.text ?? "").trim();
    if (!text) continue;
    if (turn.role === "question") {
      out.push({
        role: "question",
        key: turn.id,
        text,
        theme: turn.theme ?? undefined,
        dimension: turn.dimensionId ?? null,
        iteration: turn.iteration ?? null,
        ordinal: turn.ordinal ?? null,
        total: turn.total ?? null,
      });
      continue;
    }
    out.push({ role: turn.role, key: turn.id, text });
  }

  return out.length > 0 ? out : [{ role: "assistant", key: "initial-assistant", text: initialAssistantMessage() }];
}

function triggerDocxDownload(base64: string, fileName: string) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function ReportSectionView({ section }: { section: PreviewSection }) {
  return (
    <section className="rounded-lg border bg-white p-4 space-y-3">
      <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
      {Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && (
        <div className="space-y-2 text-sm text-gray-800">
          {section.paragraphs.map((paragraph, index) => (
            <p key={`${section.id}-p-${index}`} className="whitespace-pre-line leading-6">
              {paragraph}
            </p>
          ))}
        </div>
      )}
      {Array.isArray(section.bullets) && section.bullets.length > 0 && (
        <ul className="list-disc pl-5 space-y-1 text-sm text-gray-800">
          {section.bullets.map((bullet, index) => (
            <li key={`${section.id}-b-${index}`}>{bullet}</li>
          ))}
        </ul>
      )}
      {Array.isArray(section.tables) && section.tables.length > 0 && (
        <div className="space-y-4">
          {section.tables.map((table, tableIndex) => (
            <div key={`${section.id}-t-${tableIndex}`} className="rounded-lg border bg-gray-50 p-3">
              {table.title && <div className="mb-2 text-sm font-medium text-gray-900">{table.title}</div>}
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {table.headers.map((header, headerIndex) => (
                        <th key={`${section.id}-h-${tableIndex}-${headerIndex}`} className="border bg-gray-100 px-3 py-2 text-left font-semibold text-gray-900">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={`${section.id}-r-${tableIndex}-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${section.id}-c-${tableIndex}-${rowIndex}-${cellIndex}`} className="border bg-white px-3 py-2 align-top text-gray-800 whitespace-pre-line">
                            {cell || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ChatPanel({ sessionId }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([{ role: "assistant", key: "initial-assistant", text: initialAssistantMessage() }]);
  const [questions, setQuestions] = useState<StructuredQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [awaitingValidation, setAwaitingValidation] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [buildingReport, setBuildingReport] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [finalObjectives, setFinalObjectives] = useState<FinalObjectiveSet | null>(null);
  const [frozenDimensions, setFrozenDimensions] = useState<FrozenDimension[]>([]);
  const [reportPreview, setReportPreview] = useState<PreviewDiagnosticReport | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didBootstrapRef = useRef(false);

  const currentQuestion = useMemo(() => {
    if (questions.length === 0) return null;
    if (sessionState?.phase !== "dimension_iteration") return null;
    return questions[clampIndex(currentIndex, questions.length)] ?? null;
  }, [questions, currentIndex, sessionState?.phase]);

  function pushMessage(role: "assistant" | "user" | "system", text: string) {
    const content = String(text || "").trim();
    if (!content) return;
    setMessages((prev) => [...prev, { role, key: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: content }]);
  }

  function resetQuestionState() {
    setQuestions([]);
    setCurrentIndex(0);
  }

  function applyAssistantPayload(assistant?: AssistantResponse | null, nextSession?: SessionState | null) {
    if (!assistant) return;

    const nextQuestions = normalizeQuestions(assistant.questions);
    const needsValidation = Boolean(assistant.needs_validation);
    const nextPhase = String(nextSession?.phase ?? "");

    if (nextQuestions.length > 0 && nextPhase === "dimension_iteration") {
      const nextIndex = clampIndex(Number(nextSession?.question_index ?? 0), nextQuestions.length);
      setQuestions([...nextQuestions]);
      setCurrentIndex(nextIndex);
      setAwaitingValidation(false);
      return;
    }

    resetQuestionState();
    setAwaitingValidation(needsValidation);
  }

  function applyContextData(data: ContextApiResponse) {
    if (data.session) {
      setSessionState((current) => mergeSessionState(current, data.session, sessionId));
    }

    const nextQuestions = normalizeQuestions(data.engine_state?.question_batch_json);
    const nextPhase = String(data.session?.phase ?? "awaiting_trame");

    if (nextQuestions.length > 0 && nextPhase === "dimension_iteration") {
      const nextIndex = clampIndex(Number(data.session?.question_index ?? 0), nextQuestions.length);
      setQuestions([...nextQuestions]);
      setCurrentIndex(nextIndex);
    } else {
      resetQuestionState();
    }

    setFinalObjectives(data.engine_state?.final_objectives_json && typeof data.engine_state.final_objectives_json === "object" ? (data.engine_state.final_objectives_json as FinalObjectiveSet) : null);
    setFrozenDimensions(Array.isArray(data.engine_state?.consolidation_json) ? (data.engine_state?.consolidation_json as FrozenDimension[]) : []);

    const historyTurns = Array.isArray(data.engine_state?.conversation_history_json) ? (data.engine_state?.conversation_history_json as PersistedTurn[]) : [];
    setMessages(buildMessagesFromHistory(historyTurns));

    setAwaitingValidation(nextPhase === "iteration_validation" || nextPhase === "final_objectives_validation");
  }

  async function loadContext() {
    setBootstrapping(true);
    try {
      const res = await fetch(`/api/session/context?id=${sessionId}`, { method: "GET", cache: "no-store", credentials: "include" });
      const data: ContextApiResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur de chargement du contexte");
      applyContextData(data);
    } catch (e: any) {
      pushMessage("system", "Erreur de chargement du contexte : " + (e?.message || "Erreur inconnue"));
    } finally {
      setBootstrapping(false);
    }
  }

  async function loadSideStateSilently() {
    try {
      const res = await fetch(`/api/session/context?id=${sessionId}`, { method: "GET", cache: "no-store", credentials: "include" });
      const data: ContextApiResponse = await res.json();
      if (!data.ok) return;
      applyContextData(data);
    } catch {
      // silence volontaire
    }
  }

  async function sendMessage(message: string) {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { message, client_ts: new Date().toISOString() };
      const res = await fetch(`/api/session/${sessionId}/answer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: AnswerApiResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur moteur diagnostic");

      const mergedSession = mergeSessionState(sessionState, data.session, sessionId);
      if (mergedSession) setSessionState(mergedSession);

      const assistant = normalizeAssistantResponse(data);
      applyAssistantPayload(assistant, mergedSession);
      await loadSideStateSilently();
    } catch (e: any) {
      pushMessage("system", "Erreur : " + (e?.message || "Erreur inconnue"));
    } finally {
      setLoading(false);
    }
  }

  async function buildReport() {
    setBuildingReport(true);
    setReportPreview(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/build-report`, { method: "POST", credentials: "include" });
      const data: BuildReportApiResponse = await res.json();
      if (!data.ok) {
        const issues = Array.isArray(data.blocking_issues)
          ? data.blocking_issues.map((x) => `[${x.code ?? "ISSUE"}] ${x.message ?? ""}`.trim()).join("\n")
          : "";
        throw new Error([data.error || "Erreur build-report", issues].filter(Boolean).join("\n"));
      }

      pushMessage("assistant", "Le rapport dirigeant a été structuré et le fichier Word a été généré.");
      if (data.compliance?.summary?.length) {
        pushMessage("system", "Conformité rapport :\n" + data.compliance.summary.join("\n"));
      }
      setReportPreview(data.preview ?? null);

      if (data.docxBase64 && data.docxFileName) {
        triggerDocxDownload(data.docxBase64, data.docxFileName);
      } else {
        pushMessage("system", "Aucun fichier Word n’a été renvoyé par l’API de construction du rapport.");
      }
    } catch (e: any) {
      pushMessage("system", "Erreur lors de la construction du rapport : " + (e?.message || "Erreur inconnue"));
    } finally {
      setBuildingReport(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading || bootstrapping) return;
    const userText = input.trim();
    if (!userText) return;
    pushMessage("user", userText);
    setInput("");
    await sendMessage(userText);
  }

  useEffect(() => {
    didBootstrapRef.current = false;
    setSessionState(null);
    resetQuestionState();
    setAwaitingValidation(false);
    setFinalObjectives(null);
    setFrozenDimensions([]);
    setReportPreview(null);
    setMessages([{ role: "assistant", key: "initial-assistant", text: initialAssistantMessage() }]);
  }, [sessionId]);

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    loadContext();
  }, [sessionId]);

  useEffect(() => {
    function handleTrameIngested(event: Event) {
      const customEvent = event as CustomEvent<{ sessionId?: string }>;
      if (customEvent.detail?.sessionId !== sessionId) return;
      pushMessage("system", "Trame ingérée avec succès. Le contexte de diagnostic est rechargé.");
      loadContext();
    }

    window.addEventListener("bilan-trame-ingested", handleTrameIngested);
    return () => window.removeEventListener("bilan-trame-ingested", handleTrameIngested);
  }, [sessionId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, currentIndex, questions.length, awaitingValidation, loading, finalObjectives, frozenDimensions, reportPreview]);

  useEffect(() => {
    if (questions.length === 0) return;
    setCurrentIndex((prev) => clampIndex(prev, questions.length));
  }, [questions]);

  const placeholder = buildPlaceholder({ currentQuestion, awaitingValidation, phase: sessionState?.phase });
  const canBuildReport = sessionState?.phase === "report_ready";

  return (
    <div className="space-y-4">
      <div className="border rounded p-4 bg-gray-50">
        <div className="font-semibold mb-2">Protocole Bilan de Santé</div>
        <div className="text-sm text-gray-700">
          {bootstrapping
            ? "Chargement du contexte de diagnostic..."
            : "Le chat suit désormais le protocole 4D : trame, exploration par dimension, validations, gel, objectifs, puis rapport."}
        </div>

        {sessionState && (
          <div className="mt-3 text-xs text-gray-600 space-y-1">
            <div>Session : <strong>{sessionState.id}</strong></div>
            <div>Statut : <strong>{sessionState.status ?? "n/a"}</strong></div>
            <div>Phase : <strong>{phaseLabel(sessionState.phase)}</strong></div>
            <div>Dimension : <strong>{dimensionLabel(sessionState.dimension)}</strong></div>
            <div>Itération : <strong>{iterationLabel(sessionState.iteration)}</strong></div>
            <div>Réponses enregistrées sur l’itération courante : <strong>{sessionState.question_index ?? 0}</strong></div>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="border rounded p-4 max-h-[380px] overflow-y-auto space-y-3 bg-white">
        {messages.map((m) => {
          if (m.role === "question") {
            return (
              <div key={m.key} className="bg-gray-50 mr-8 rounded p-3 border">
                <div className="text-xs text-gray-500 mb-2">
                  Dimension {m.dimension ?? "?"} — Itération {m.iteration ?? "?"}/3 — Question {m.ordinal ?? "?"} / {m.total ?? "?"}
                </div>
                {m.theme && <div className="text-xs text-gray-500 mb-2">Thème : {m.theme}</div>}
                <div><span className="font-semibold">Question : </span>{m.text}</div>
              </div>
            );
          }

          const isUser = m.role === "user";
          const isSystem = m.role === "system";
          return (
            <div
              key={m.key}
              className={[
                "whitespace-pre-line rounded p-3",
                isUser ? "bg-black text-white ml-8" : isSystem ? "bg-red-50 text-red-700" : "bg-gray-50 mr-8",
              ].join(" ")}
            >
              {m.text}
            </div>
          );
        })}
      </div>

      {currentQuestion && (
        <div className="border rounded p-4 bg-gray-50 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <div className="font-semibold">Dimension {sessionState?.dimension ?? "?"} — Itération {sessionState?.iteration ?? "?"}/3</div>
            <div>Question {Math.min(currentIndex + 1, questions.length)} / {questions.length}</div>
          </div>
          {currentQuestion.theme && <div className="text-xs text-gray-500">Thème : {currentQuestion.theme}</div>}
          <div className="border rounded bg-white p-4 space-y-3">
            <div><span className="font-semibold">Constat : </span>{currentQuestion.constat}</div>
            <div><span className="font-semibold">Risque managérial : </span>{currentQuestion.risque_managerial}</div>
            <div><span className="font-semibold">Question : </span>{currentQuestion.question}</div>
          </div>
        </div>
      )}

      {!currentQuestion && awaitingValidation && (
        <div className="border rounded p-4 bg-gray-50">
          <div className="font-semibold mb-2">
            {sessionState?.phase === "final_objectives_validation" ? "Validation des objectifs" : "Validation d’itération"}
          </div>
          <div className="text-sm text-gray-700">
            {sessionState?.phase === "final_objectives_validation" ? (
              <>Répondez par <strong>oui</strong> pour tout valider, ou détaillez objectif par objectif.</>
            ) : (
              <>Répondez simplement par <strong>oui</strong> ou <strong>non</strong>.</>
            )}
          </div>
        </div>
      )}

      {canBuildReport && (
        <div className="border rounded p-4 bg-white space-y-3">
          <div className="font-semibold">Rapport standardisé</div>
          <div className="text-sm text-gray-700">Le protocole est terminé. La construction du rapport génère un aperçu structuré lisible et déclenche le téléchargement du fichier Word.</div>
          <button
            type="button"
            onClick={buildReport}
            disabled={buildingReport}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {buildingReport ? "Construction..." : "Construire le rapport"}
          </button>
        </div>
      )}

      {reportPreview && (
        <div className="border rounded p-4 bg-white space-y-4">
          <div>
            <div className="font-semibold">Aperçu structuré du rapport</div>
            <div className="text-sm text-gray-600">Titre : {reportPreview.title}</div>
            <div className="text-sm text-gray-600">Généré le : {reportPreview.generatedAt}</div>
          </div>
          <div className="space-y-4">
            {reportPreview.sections.map((section) => (
              <ReportSectionView key={section.id} section={section} />
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || bootstrapping || canBuildReport}
        />
        <button
          type="submit"
          disabled={loading || bootstrapping || canBuildReport || input.trim().length === 0}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Envoi..." : bootstrapping ? "Chargement..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
