import BrandMark from "./BrandMark";
import DialogueDiagnosticPanel from "./DialogueDiagnosticPanel";
import ReportBuilderPanel from "./ReportBuilderPanel";
import { DIAGNOSTIC_JOURNEY_STEPS } from "@/lib/diagnostic/conversationProtocol";

type Props = {
  sessionId: string;
};

export default function SessionWorkspace({ sessionId }: Props) {
  return (
    <div className="space-y-6 rounded-[28px] bg-[#F4F7FA] p-2 md:p-3">
      <section className="overflow-hidden rounded-2xl border border-[#C9D8E6] bg-white shadow-[0_10px_30px_rgba(23,58,94,0.07)]">
        <div className="h-1.5 bg-gradient-to-r from-[#173A5E] via-[#3676A8] to-[#78A9CE]" />
        <div className="flex flex-col gap-6 p-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <BrandMark />
            <p className="max-w-3xl text-sm leading-6 text-[#43566B]">
              Le diagnostic est conduit sous forme d’un entretien structuré avec l’IA.
              L’IA analyse la matière communiquée, identifie les points d’étonnement et
              approfondit progressivement le diagnostic. L’application garantit le
              respect de la méthode, le séquencement et la traçabilité des échanges.
            </p>
          </div>

          <div className="max-w-sm rounded-xl border border-[#C9D8E6] bg-[#EAF2F8] px-4 py-3 text-sm leading-6 text-[#294762] shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-[#173A5E]">
              <span className="h-2 w-2 rounded-full bg-[#3676A8]" />
              Principe de travail
            </div>
            <div className="mt-1.5">
              Vous répondez librement. Les informations disponibles, les écarts, les
              incohérences et les données non suivies alimentent ensuite les questions
              du consultant IA.
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="self-start xl:sticky xl:top-6">
          <section className="space-y-4 rounded-2xl border border-[#C9D8E6] bg-white p-5 shadow-[0_8px_24px_rgba(23,58,94,0.06)]">
            <div className="border-b border-[#E1EAF1] pb-4">
              <h2 className="text-base font-semibold text-[#173A5E]">
                Parcours du diagnostic
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#66788A]">
                L’application contrôle l’enchaînement ; l’IA conduit l’entretien et les
                approfondissements.
              </p>
            </div>

            <ol className="space-y-2 text-sm text-[#43566B]">
              {DIAGNOSTIC_JOURNEY_STEPS.map((step, index) => (
                <li
                  key={step}
                  className="group flex items-center gap-3 rounded-xl border border-[#D9E4ED] bg-[#F8FAFC] px-3 py-2.5 transition hover:border-[#AFC5D7] hover:bg-[#EFF5F9]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E3EDF5] text-xs font-bold text-[#173A5E] transition group-hover:bg-[#173A5E] group-hover:text-white">
                    {index + 1}
                  </span>
                  <span className="font-medium leading-5">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>

        <main className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-[#C9D8E6] bg-white p-5 shadow-[0_8px_24px_rgba(23,58,94,0.06)]">
            <div className="mb-4 border-b border-[#E1EAF1] pb-4">
              <h2 className="text-lg font-semibold text-[#173A5E]">
                Entretien de diagnostic
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#66788A]">
                Commencez directement par le dialogue. Aucun document préalable n’est
                nécessaire pour engager le diagnostic.
              </p>
            </div>

            <DialogueDiagnosticPanel sessionId={sessionId} />
          </section>

          <ReportBuilderPanel sessionId={sessionId} />
        </main>
      </div>
    </div>
  );
}
