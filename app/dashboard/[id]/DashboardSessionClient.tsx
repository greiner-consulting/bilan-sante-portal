"use client";

import ChatPanel from "./ChatPanel";
import TrameUploadForm from "./TrameUploadForm";

type Props = {
  sessionId: string;
};

export default function DashboardSessionClient({ sessionId }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Diagnostic d’entreprise</h1>
        <p className="text-sm text-gray-600 mt-1">Session : {sessionId}</p>
      </div>

      <div className="border rounded p-4 bg-white space-y-3">
        <div className="font-semibold">Chargement de la trame</div>

        <TrameUploadForm sessionId={sessionId} />

        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Après ingestion de la trame, vous pouvez démarrer le diagnostic
          directement dans le chat ci-dessous.
        </div>
      </div>

      <ChatPanel sessionId={sessionId} />
    </div>
  );
}