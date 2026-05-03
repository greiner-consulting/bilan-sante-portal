import fs from "fs";
import pdfParse from "pdf-parse";
import JSZip from "jszip";

/*
 * improvedDocumentExtractor.ts
 *
 * This module centralises the extraction logic for legacy documents (TXT, Markdown, DOCX and PDF)
 * and improves it by leveraging specialised parsers.  It returns structured text along with
 * a detected format so that downstream modules can make better decisions.  PDF extraction
 * leverages the `pdf-parse` library to read actual PDF text rather than using a simplistic
 * ASCII fallback.  DOCX extraction uses JSZip to unzip the document and parse the
 * underlying XML, much like the previous implementation.  Markdown and plain text
 * extraction simply decode the buffer as UTF‑8 and normalise newlines.
 */

export type ExtractedDocFormat = "txt" | "md" | "docx" | "pdf";

export interface ExtractedDoc {
  text: string;
  detected_format: ExtractedDocFormat;
}

/**
 * Normalises extracted text by removing carriage returns, deduplicating spaces and
 * collapsing multiple blank lines.  This helper mirrors the original normalisation
 * used in legacyDocumentToText.ts.
 */
function normaliseText(value: string): string {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  // Unzip the DOCX file and extract the main document.xml.  If missing, throw an error.
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
  return normaliseText(plain);
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // Use pdf-parse to extract text.  If the library cannot extract any text, throw an error.
  try {
    const result = await pdfParse(buffer);
    const text = normaliseText(result.text);
    if (!text || text.length < 80) {
      throw new Error("PDF_TEXT_EMPTY");
    }
    return text;
  } catch (err) {
    throw new Error(`PDF_TEXT_EXTRACTION_FAILED: ${String(err)}`);
  }
}

/**
 * Extract text from a document buffer.  This function inspects the MIME type or filename
 * to determine the format, then dispatches to the appropriate specialised extractor.
 */
export async function extractDocument(params: {
  buffer: Buffer;
  mimeType?: string;
  filename?: string;
}): Promise<ExtractedDoc> {
  const mimeType = String(params.mimeType || "").toLowerCase();
  const filename = String(params.filename || "").toLowerCase();
  const buf = Buffer.from(params.buffer);

  const isTxt = mimeType === "text/plain" || filename.endsWith(".txt");
  const isMd = mimeType === "text/markdown" || filename.endsWith(".md");
  const isDocx =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.endsWith(".docx");
  const isPdf = mimeType === "application/pdf" || filename.endsWith(".pdf");

  if (isTxt) {
    const text = normaliseText(buf.toString("utf-8"));
    return { text, detected_format: "txt" };
  }
  if (isMd) {
    const text = normaliseText(buf.toString("utf-8"));
    return { text, detected_format: "md" };
  }
  if (isDocx) {
    const text = await extractDocx(buf);
    return { text, detected_format: "docx" };
  }
  if (isPdf) {
    const text = await extractPdf(buf);
    return { text, detected_format: "pdf" };
  }
  throw new Error("UNSUPPORTED_FILE_TYPE");
}