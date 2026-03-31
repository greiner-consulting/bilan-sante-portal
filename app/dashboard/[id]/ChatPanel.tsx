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
  summary?: string;
  evidenceSummary?: string[];
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
  source_filename?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  compliance?: {
    ok: boolean;
    warnings?: Array<{ code?: string; message?: string } | string>;
    summary?: string[];
  };
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

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatDateTime(value?: string | null): string {
  const text = normalizeText(value);
  if (!text) return "n/a";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function displayFileName(value?: string | null): string {
  const text = normalizeText(value);
  return text || "Trame non renseignée";
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

function mergeSessionState(
  current: SessionState | null,
  next?: SessionState | null,
  fallbackId?: string
): SessionState | null {
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

  if (
    typeof data.assistant_message !== "undefined" ||
    typeof data.questions !== "undefined" ||
    typeof data.needs_validation !== "undefined"
  ) {
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

function validationStatusLabel(value: FinalObjective["validationStatus"]) {
  switch (value) {
    case "validated":
      return "Validé";
    case "adjusted":
      return "Ajusté";
    case "refused":
      return "Refusé";
    case "proposed":
    default:
      return "Proposé";
  }
}

function buildPlaceholder(params: {
  currentQuestion: StructuredQuestion | null;
  awaitingValidation: boolean;
  phase?: string | null;
}) {
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

  return out.length > 0
    ? out
    : [{ role: "assistant", key: "initial-assistant", text: initialAssistantMessage() }];
}

function triggerDocxDownload(base64: string, fileName: string) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
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
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-900">{section.title}</h3>
      {Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && (
        <div className="space-y-2 text-sm leading-6 text-slate-800">
          {section.paragraphs.map((paragraph, index) => (
            <p key={`${section.id}-p-${index}`} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      )}
      {Array.isArray(section.bullets) && section.bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
          {section.bullets.map((bullet, index) => (
            <li key={`${section.id}-b-${index}`}>{bullet}</li>
          ))}
        </ul>
      )}
      {Array.isArray(section.tables) && section.tables.length > 0 && (
        <div className="space-y-4">
          {section.tables.map((table, tableIndex) => (
            <div
              key={`${section.id}-t-${tableIndex}`}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              {table.title && (
                <div className="mb-2 text-sm font-medium text-slate-900">
                  {table.title}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {table.headers.map((header, headerIndex) => (
                        <th
                          key={`${section.id}-h-${tableIndex}-${headerIndex}`}
                          className="border border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-900"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={`${section.id}-r-${tableIndex}-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`${section.id}-c-${tableIndex}-${rowIndex}-${cellIndex}`}
                            className="whitespace-pre-line border border-slate-200 bg-white px-3 py-2 align-top text-slate-800"
                          >
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

function FrozenDimensionCard({ dimension }: { dimension: FrozenDimension }) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {dimensionLabel(dimension.dimensionId)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Gelée le {formatDateTime(dimension.frozenAt)}
          </div>
        </div>
        <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
          Score : {dimension.score}/5
        </div>
      </div>

      {dimension.summary && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800">
          {dimension.summary}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-semibold text-slate-900">Constats consolidés</div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-800">
          {dimension.consolidatedFindings.map((item, index) => (
            <li key={`finding-${dimension.dimensionId}-${index}`}>{item}</li>
          ))}
        </ol>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="text-sm font-semibold text-amber-900">Cause racine dominante</div>
        <div className="mt-1 text-sm leading-6 text-amber-900">
          {dimension.dominantRootCause}
        </div>
      </div>

      {Array.isArray(dimension.evidenceSummary) && dimension.evidenceSummary.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-900">
            Éléments de matière consolidés
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
            {dimension.evidenceSummary.map((item, index) => (
              <li key={`evidence-${dimension.dimensionId}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <div className="text-sm font-semibold text-slate-900">Zones non pilotées</div>
        {dimension.unmanagedZones.map((zone, index) => (
          <div
            key={`zone-${dimension.dimensionId}-${index}`}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <div className="mb-2 text-sm font-medium text-slate-900">Zone {index + 1}</div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Constat
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-800">
                  {zone.constat}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Risque managérial
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-800">
                  {zone.risqueManagerial}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Conséquence
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-800">
                  {zone.consequence}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ObjectiveCardView({ objective }: { objective: FinalObjective }) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {dimensionLabel(objective.dimensionId)}
          </div>
          <div className="mt-1 text-base font-medium leading-6 text-slate-900">
            {objective.objectiveLabel}
          </div>
        </div>
        <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
          {validationStatusLabel(objective.validationStatus)}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Indicateur clé
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-800">
            {objective.keyIndicator}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Échéance
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-800">{objective.dueDate}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Responsable
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-800">{objective.owner}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quick win
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-800">{objective.quickWin}</div>
        </div>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Gain potentiel
        </div>
        <div className="mt-1 text-sm leading-6 text-emerald-900">
          {objective.potentialGain}
        </div>
      </div>

      {Array.isArray(objective.gainHypotheses) && objective.gainHypotheses.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Hypothèses de gain
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
            {objective.gainHypotheses.map((item, index) => (
              <li key={`hyp-${objective.id}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({ sessionId }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    { role: "assistant", key: "initial-assistant", text: initialAssistantMessage() },
  ]);
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

  const sortedFrozenDimensions = useMemo(
    () => [...frozenDimensions].sort((a, b) => a.dimensionId - b.dimensionId),
    [frozenDimensions]
  );

  const sortedObjectives = useMemo(
    () =>
      [...(finalObjectives?.objectives ?? [])].sort(
        (a, b) => Number(a.dimensionId) - Number(b.dimensionId)
      ),
    [finalObjectives]
  );

  function pushMessage(role: "assistant" | "user" | "system", text: string) {
    const content = String(text || "").trim();
    if (!content) return;
    setMessages((prev) => [
      ...prev,
      { role, key: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: content },
    ]);
  }

  function resetQuestionState() {
    setQuestions([]);
    setCurrentIndex(0);
  }

  function applyAssistantPayload(
    assistant?: AssistantResponse | null,
    nextSession?: SessionState | null
  ) {
    if (!assistant) return;

    const nextQuestions = normalizeQuestions(assistant.questions);
    const needsValidation = Boolean(assistant.needs_validation);
    const nextPhase = String(nextSession?.phase ?? "");

    if (nextQuestions.length > 0 && nextPhase === "dimension_iteration") {
      const nextIndex = clampIndex(
        Number(nextSession?.question_index ?? 0),
        nextQuestions.length
      );
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
      const nextIndex = clampIndex(
        Number(data.session?.question_index ?? 0),
        nextQuestions.length
      );
      setQuestions([...nextQuestions]);
      setCurrentIndex(nextIndex);
    } else {
      resetQuestionState();
    }

    setFinalObjectives(
      data.engine_state?.final_objectives_json &&
        typeof data.engine_state.final_objectives_json === "object"
        ? (data.engine_state.final_objectives_json as FinalObjectiveSet)
        : null
    );
    setFrozenDimensions(
      Array.isArray(data.engine_state?.consolidation_json)
        ? (data.engine_state.consolidation_json as FrozenDimension[])
        : []
    );

    const historyTurns = Array.isArray(data.engine_state?.conversation_history_json)
      ? (data.engine_state.conversation_history_json as PersistedTurn[])
      : [];
    setMessages(buildMessagesFromHistory(historyTurns));

    setAwaitingValidation(
      nextPhase === "iteration_validation" ||
        nextPhase === "final_objectives_validation"
    );
  }

  async function loadContext() {
    setBootstrapping(true);
    try {
      const res = await fetch(`/api/session/context?id=${sessionId}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data: ContextApiResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur de chargement du contexte");
      applyContextData(data);
    } catch (e: any) {
      pushMessage(
        "system",
        "Erreur de chargement du contexte : " + (e?.message || "Erreur inconnue")
      );
    } finally {
      setBootstrapping(false);
    }
  }

  async function loadSideStateSilently() {
    try {
      const res = await fetch(`/api/session/context?id=${sessionId}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
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
      const payload: Record<string, unknown> = {
        message,
        client_ts: new Date().toISOString(),
      };
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
      const res = await fetch(`/api/session/${sessionId}/build-report`, {
        method: "POST",
        credentials: "include",
      });
      const data: BuildReportApiResponse = await res.json();
      if (!data.ok) {
        const issues = Array.isArray(data.blocking_issues)
          ? data.blocking_issues
              .map((x) => `[${x.code ?? "ISSUE"}] ${x.message ?? ""}`.trim())
              .join("\n")
          : "";
        throw new Error(
          [data.error || "Erreur build-report", issues].filter(Boolean).join("\n")
        );
      }

      pushMessage(
        "assistant",
        "Le rapport dirigeant a été structuré et le fichier Word a été généré."
      );
      if (data.compliance?.summary?.length) {
        pushMessage(
          "system",
          "Conformité rapport :\n" + data.compliance.summary.join("\n")
        );
      }
      setReportPreview(data.preview ?? null);

      if (data.docxBase64 && data.docxFileName) {
        triggerDocxDownload(data.docxBase64, data.docxFileName);
      } else {
        pushMessage(
          "system",
          "Aucun fichier Word n’a été renvoyé par l’API de construction du rapport."
        );
      }
    } catch (e: any) {
      pushMessage(
        "system",
        "Erreur lors de la construction du rapport : " +
          (e?.message || "Erreur inconnue")
      );
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
    setMessages([
      { role: "assistant", key: "initial-assistant", text: initialAssistantMessage() },
    ]);
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
      pushMessage(
        "system",
        "Trame ingérée avec succès. Le contexte de diagnostic est rechargé."
      );
      loadContext();
    }

    window.addEventListener("bilan-trame-ingested", handleTrameIngested);
    return () =>
      window.removeEventListener("bilan-trame-ingested", handleTrameIngested);
  }, [sessionId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    messages,
    currentIndex,
    questions.length,
    awaitingValidation,
    loading,
    finalObjectives,
    frozenDimensions,
    reportPreview,
  ]);

  useEffect(() => {
    if (questions.length === 0) return;
    setCurrentIndex((prev) => clampIndex(prev, questions.length));
  }, [questions]);

  const placeholder = buildPlaceholder({
    currentQuestion,
    awaitingValidation,
    phase: sessionState?.phase,
  });
  const canBuildReport = sessionState?.phase === "report_ready";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 font-semibold text-slate-900">Protocole Bilan de Santé</div>
        <div className="text-sm leading-6 text-slate-700">
          {bootstrapping
            ? "Chargement du contexte de diagnostic..."
            : "Le chat suit désormais le protocole 4D : trame, exploration par dimension, validations, gel, objectifs, puis rapport."}
        </div>

        {sessionState && (
          <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Trame active
              </div>
              <div
                className="mt-1 font-medium text-slate-900"
                title={displayFileName(sessionState.source_filename)}
              >
                {displayFileName(sessionState.source_filename)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Date de chargement
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {formatDateTime(sessionState.updated_at ?? sessionState.created_at)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Phase
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {phaseLabel(sessionState.phase)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Statut
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {sessionState.status ?? "n/a"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Dimension
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {dimensionLabel(sessionState.dimension)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Itération
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {iterationLabel(sessionState.iteration)}
              </div>
            </div>
          </div>
        )}
      </div>

      {sortedFrozenDimensions.length > 0 && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <div className="font-semibold text-slate-900">Dimensions gelées</div>
            <div className="text-sm leading-6 text-slate-600">
              Les constats consolidés, causes racines dominantes et zones non pilotées
              restent visibles pendant toute la fin du protocole.
            </div>
          </div>
          <div className="grid gap-4">
            {sortedFrozenDimensions.map((dimension) => (
              <FrozenDimensionCard
                key={`frozen-${dimension.dimensionId}`}
                dimension={dimension}
              />
            ))}
          </div>
        </div>
      )}

      {sortedObjectives.length > 0 && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <div className="font-semibold text-slate-900">Objectifs orientés résultats</div>
            <div className="text-sm leading-6 text-slate-600">
              {sessionState?.phase === "final_objectives_validation"
                ? "Ces objectifs sont proposés au dirigeant pour validation, ajustement ou refus."
                : "Ces objectifs sont issus des dimensions gelées et restent visibles jusqu’à la construction du rapport."}
            </div>
          </div>
          <div className="grid gap-4">
            {sortedObjectives.map((objective) => (
              <ObjectiveCardView key={objective.id} objective={objective} />
            ))}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="max-h-[420px] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4"
      >
        {messages.map((m) => {
          if (m.role === "question") {
            return (
              <div
                key={m.key}
                className="mr-8 rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                  Dimension {m.dimension ?? "?"} — Itération {m.iteration ?? "?"}/3 —
                  Question {m.ordinal ?? "?"} / {m.total ?? "?"}
                </div>
                {m.theme && (
                  <div className="mb-2 text-xs text-slate-500">Thème : {m.theme}</div>
                )}
                <div className="text-sm leading-6 text-slate-800">
                  <span className="font-semibold text-slate-900">Question : </span>
                  {m.text}
                </div>
              </div>
            );
          }

          const isUser = m.role === "user";
          const isSystem = m.role === "system";
          const messageClasses = isUser
            ? "ml-8 border-slate-900 bg-slate-900 text-white"
            : isSystem
              ? "mr-8 border-red-200 bg-red-50 text-red-700"
              : "mr-8 border-slate-200 bg-slate-50 text-slate-800";

          return (
            <div
              key={m.key}
              className={`whitespace-pre-line rounded-xl border p-3 text-sm leading-6 ${messageClasses}`}
            >
              {m.text}
            </div>
          );
        })}
      </div>

      {currentQuestion && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between text-sm text-slate-700">
            <div className="font-semibold text-slate-900">
              Dimension {sessionState?.dimension ?? "?"} — Itération
              {" "}
              {sessionState?.iteration ?? "?"}/3
            </div>
            <div>
              Question {Math.min(currentIndex + 1, questions.length)} / {questions.length}
            </div>
          </div>
          {currentQuestion.theme && (
            <div className="text-xs text-slate-500">Thème : {currentQuestion.theme}</div>
          )}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-800">
            <div>
              <span className="font-semibold text-slate-900">Constat : </span>
              {currentQuestion.constat}
            </div>
            <div>
              <span className="font-semibold text-slate-900">Risque managérial : </span>
              {currentQuestion.risque_managerial}
            </div>
            <div>
              <span className="font-semibold text-slate-900">Question : </span>
              {currentQuestion.question}
            </div>
          </div>
        </div>
      )}

      {!currentQuestion && awaitingValidation && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 font-semibold text-slate-900">
            {sessionState?.phase === "final_objectives_validation"
              ? "Validation des objectifs"
              : "Validation d’itération"}
          </div>
          <div className="text-sm leading-6 text-slate-700">
            {sessionState?.phase === "final_objectives_validation" ? (
              <>
                Répondez par <strong>oui</strong> pour tout valider, ou détaillez
                objectif par objectif.
              </>
            ) : (
              <>
                Répondez simplement par <strong>oui</strong> ou <strong>non</strong>.
              </>
            )}
          </div>
        </div>
      )}

      {canBuildReport && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-semibold text-slate-900">Rapport standardisé</div>
          <div className="text-sm leading-6 text-slate-700">
            Le protocole est terminé. La construction du rapport génère un aperçu
            structuré lisible et déclenche le téléchargement du fichier Word.
          </div>
          <button
            type="button"
            onClick={buildReport}
            disabled={buildingReport}
            className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {buildingReport ? "Construction..." : "Construire le rapport"}
          </button>
        </div>
      )}

      {reportPreview && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <div className="font-semibold text-slate-900">Aperçu structuré du rapport</div>
            <div className="text-sm text-slate-600">Titre : {reportPreview.title}</div>
            <div className="text-sm text-slate-600">
              Généré le : {formatDateTime(reportPreview.generatedAt)}
            </div>
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
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || bootstrapping || canBuildReport}
        />
        <button
          type="submit"
          disabled={
            loading || bootstrapping || canBuildReport || input.trim().length === 0
          }
          className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Envoi..." : bootstrapping ? "Chargement..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
