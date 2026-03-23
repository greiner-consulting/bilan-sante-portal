import JSZip from "jszip";

export type SupportedLegacyMime =
  | "text/plain"
  | "text/markdown"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/pdf";

export type ExtractLegacyTextResult = {
  text: string;
  detected_format: "txt" | "md" | "docx" | "pdf";
};

function decodeBuffer(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function normalizeExtractedText(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");

  if (!documentXml) {
    throw new Error("DOCX_INVALID_CONTENT");
  }

  const withParagraphs = documentXml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\/>/g, "\n");

  const plain = withParagraphs
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return normalizeExtractedText(plain);
}

function extractPdfTextFallback(buffer: ArrayBuffer): string {
  const raw = new Uint8Array(buffer);
  const decoded = Array.from(raw)
    .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : " "))
    .join("");

  const extracted = decoded
    .replace(/\s+/g, " ")
    .match(/[A-Za-zÀ-ÿ0-9][^]{0,200000}/)?.[0] || "";

  return normalizeExtractedText(extracted);
}

export async function extractLegacyDocumentText(params: {
  buffer: ArrayBuffer;
  mimeType?: string;
  filename?: string;
}): Promise<ExtractLegacyTextResult> {
  const mimeType = String(params.mimeType || "").toLowerCase();
  const filename = String(params.filename || "").toLowerCase();

  const isTxt =
    mimeType === "text/plain" ||
    filename.endsWith(".txt");

  const isMd =
    mimeType === "text/markdown" ||
    filename.endsWith(".md");

  const isDocx =
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.endsWith(".docx");

  const isPdf =
    mimeType === "application/pdf" ||
    filename.endsWith(".pdf");

  if (isTxt) {
    return {
      text: normalizeExtractedText(decodeBuffer(params.buffer)),
      detected_format: "txt",
    };
  }

  if (isMd) {
    return {
      text: normalizeExtractedText(decodeBuffer(params.buffer)),
      detected_format: "md",
    };
  }

  if (isDocx) {
    const text = await extractDocxText(params.buffer);
    if (!text) {
      throw new Error("DOCX_TEXT_EMPTY");
    }

    return {
      text,
      detected_format: "docx",
    };
  }

  if (isPdf) {
    const text = extractPdfTextFallback(params.buffer);
    if (!text || text.length < 80) {
      throw new Error("PDF_TEXT_EXTRACTION_FAILED");
    }

    return {
      text,
      detected_format: "pdf",
    };
  }

  throw new Error("UNSUPPORTED_FILE_TYPE");
}