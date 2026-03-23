import "server-only";
import crypto from "crypto";

export type TrameIndexChunk = {
  id: string;
  order: number;
  text: string;
};

export type TrameIndexJSON = {
  index_version: string; // "1.0"
  meta: {
    filename?: string | null;
    mime?: string | null;
    size_bytes?: number | null;
    sha256?: string | null;
    created_at: string; // ISO
  };
  chunks: TrameIndexChunk[];
};

/**
 * SHA256 d'un Buffer (pour trame_sha256)
 */
export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Chunking simple et robuste (V1) :
 * - split par paragraphes
 * - regroupe pour ne pas dépasser ~1200 chars
 */
export function buildTrameIndexFromText(args: {
  text: string;
  meta: TrameIndexJSON["meta"];
  indexVersion?: string;
  targetChunkSize?: number;
}): TrameIndexJSON {
  const index_version = args.indexVersion ?? "1.0";
  const target = args.targetChunkSize ?? 1200;

  const rawParts = args.text
    .replace(/\r/g, "")
    .split(/\n{2,}/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: TrameIndexChunk[] = [];
  let current = "";
  let order = 1;

  const flush = () => {
    const t = current.trim();
    if (!t) return;
    chunks.push({
      id: `c${order}`,
      order,
      text: t,
    });
    order += 1;
    current = "";
  };

  for (const part of rawParts) {
    // si la pièce est énorme, on la découpe brut
    if (part.length > target * 2) {
      flush();
      let offset = 0;
      while (offset < part.length) {
        const slice = part.slice(offset, offset + target);
        chunks.push({
          id: `c${order}`,
          order,
          text: slice.trim(),
        });
        order += 1;
        offset += target;
      }
      continue;
    }

    if ((current + "\n\n" + part).length > target) {
      flush();
    }
    current = current ? `${current}\n\n${part}` : part;
  }

  flush();

  return {
    index_version,
    meta: {
      ...args.meta,
      created_at: new Date().toISOString(),
    },
    chunks,
  };
}