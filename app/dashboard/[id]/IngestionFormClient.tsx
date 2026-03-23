"use client";

import * as React from "react";
import { ingestTrameAction, type UploadState } from "./actions";

const initialState: UploadState = {
  ok: false,
};

export default function IngestionFormClient({
  sessionId,
}: {
  sessionId: string;
}) {
  const [state, formAction] = React.useActionState(
    async (_prev: UploadState, formData: FormData): Promise<UploadState> => {
      return ingestTrameAction(initialState, formData);
    },
    initialState
  );

  return (
    <div className="space-y-3">
      {state?.error && (
        <div className="text-sm text-red-600">{state.error}</div>
      )}

      {state?.message && (
        <div className="text-sm text-green-600">{state.message}</div>
      )}

      <form action={formAction}>
        <input type="hidden" name="sessionId" value={sessionId} />

        <button className="bg-black text-white px-4 py-2 rounded">
          Lancer ingestion
        </button>
      </form>
    </div>
  );
}