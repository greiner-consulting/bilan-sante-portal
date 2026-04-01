import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";
import {
  buildPreviewDiagnosticReport,
  type PreviewDiagnosticReport,
  type PreviewSection,
  type StandardDiagnosticReport,
} from "@/lib/bilan-sante/report-builder";

type PdfBuilderOptions = {
  logoPath?: string;
};

type TextStyle = {
  font: PDFFont;
  size: number;
  color: RGB;
  lineHeight: number;
};

type TableModel = {
  title?: string;
  headers: string[];
  rows: string[][];
};

type PdfCursor = {
  page: PDFPage;
  y: number;
  pageNumber: number;
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  marginTop: 56,
  marginRight: 52,
  marginBottom: 54,
  marginLeft: 52,
};

const COLORS = {
  text: rgb(0.192, 0.235, 0.325),
  muted: rgb(0.376, 0.431, 0.529),
  heading: rgb(0.059, 0.102, 0.204),
  border: rgb(0.804, 0.835, 0.882),
  borderStrong: rgb(0.663, 0.718, 0.788),
  headerFill: rgb(0.953, 0.957, 0.969),
  sectionRule: rgb(0.871, 0.898, 0.937),
  white: rgb(1, 1, 1),
};

const FONTS = {
  coverKicker: 26,
  coverTitle: 34,
  h1: 17,
  h2: 13,
  body: 10.6,
  small: 9.2,
  tableHeader: 9.4,
  tableBody: 9.1,
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function safeText(value: unknown): string {
  const text = normalizeText(value);
  return text || "—";
}

function availableWidth(): number {
  return PAGE.width - PAGE.marginLeft - PAGE.marginRight;
}

function createPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE.width, PAGE.height]);
}

function contentTopY(): number {
  return PAGE.height - PAGE.marginTop;
}

function contentBottomY(): number {
  return PAGE.marginBottom;
}

function measureText(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function splitLongToken(
  font: PDFFont,
  token: string,
  size: number,
  maxWidth: number
): string[] {
  if (measureText(font, token, size) <= maxWidth) return [token];

  const parts: string[] = [];
  let current = "";
  for (const char of token) {
    const candidate = `${current}${char}`;
    if (current && measureText(font, candidate, size) > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [token];
}

function wrapSingleParagraph(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number
): string[] {
  const paragraph = String(text ?? "").trim();
  if (!paragraph) return [""];

  const rawTokens = paragraph.split(/\s+/g).filter(Boolean);
  const tokens = rawTokens.flatMap((token) =>
    splitLongToken(font, token, size, maxWidth)
  );
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (current && measureText(font, candidate, size) > maxWidth) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function wrapText(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number
): string[] {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const paragraphs = normalized.split("\n");
  const lines: string[] = [];

  paragraphs.forEach((paragraph, index) => {
    const wrapped = wrapSingleParagraph(font, paragraph, size, maxWidth);
    lines.push(...wrapped);
    if (index < paragraphs.length - 1) lines.push("");
  });

  return lines.length > 0 ? lines : [""];
}

function textHeight(lineCount: number, lineHeight: number): number {
  return Math.max(1, lineCount) * lineHeight;
}

function drawWrappedText(params: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  width: number;
  style: TextStyle;
}): number {
  const { page, text, x, y, width, style } = params;
  const lines = wrapText(style.font, text, style.size, width);
  let cursorY = y;

  for (const line of lines) {
    if (line) {
      page.drawText(line, {
        x,
        y: cursorY - style.size,
        size: style.size,
        font: style.font,
        color: style.color,
      });
    }
    cursorY -= style.lineHeight;
  }

  return y - cursorY;
}

function drawRule(page: PDFPage, y: number): void {
  page.drawLine({
    start: { x: PAGE.marginLeft, y },
    end: { x: PAGE.width - PAGE.marginRight, y },
    thickness: 1,
    color: COLORS.sectionRule,
  });
}

function headerFractions(headers: string[]): number[] {
  const normalized = headers.map((header) => normalizeText(header).toLowerCase());

  if (headers.length === 1) return [1];
  if (headers.length === 2) {
    if (normalized[0] === "#") return [0.11, 0.89];
    if (normalized[0] === "champ") return [0.26, 0.74];
    if (normalized[0].includes("dimension")) {
      return [0.18, 0.34, 0.18, 0.15, 0.15].slice(0, headers.length);
    }
    return [0.36, 0.64];
  }
  if (headers.length === 4) return [0.25, 0.25, 0.25, 0.25];
  if (headers.length === 5) return [0.16, 0.33, 0.19, 0.14, 0.18];
  return Array.from({ length: headers.length }, () => 1 / headers.length);
}

function computeColumnWidths(totalWidth: number, headers: string[]): number[] {
  const fractions = headerFractions(headers);
  const sum = fractions.reduce((acc, value) => acc + value, 0) || 1;
  const widths = fractions.map((value) => (totalWidth * value) / sum);
  const used = widths.reduce((acc, value) => acc + value, 0);
  widths[widths.length - 1] += totalWidth - used;
  return widths;
}

function tableRowHeight(params: {
  font: PDFFont;
  size: number;
  lineHeight: number;
  row: string[];
  widths: number[];
  paddingX: number;
  paddingY: number;
}): number {
  const { font, size, lineHeight, row, widths, paddingX, paddingY } = params;
  let maxLines = 1;

  row.forEach((cell, index) => {
    const lines = wrapText(
      font,
      safeText(cell),
      size,
      Math.max(10, widths[index] - paddingX * 2)
    );
    maxLines = Math.max(maxLines, lines.length);
  });

  return textHeight(maxLines, lineHeight) + paddingY * 2;
}

function drawTableRow(params: {
  page: PDFPage;
  topY: number;
  headers: string[];
  row: string[];
  widths: number[];
  isHeader: boolean;
  regularFont: PDFFont;
  boldFont: PDFFont;
  tableX: number;
}): number {
  const {
    page,
    topY,
    headers,
    row,
    widths,
    isHeader,
    regularFont,
    boldFont,
    tableX,
  } = params;

  const paddingX = 7;
  const paddingY = isHeader ? 7 : 6;
  const font = isHeader ? boldFont : regularFont;
  const size = isHeader ? FONTS.tableHeader : FONTS.tableBody;
  const lineHeight = isHeader ? 12 : 11.3;
  const rowHeight = tableRowHeight({
    font,
    size,
    lineHeight,
    row,
    widths,
    paddingX,
    paddingY,
  });

  let x = tableX;
  widths.forEach((width, index) => {
    page.drawRectangle({
      x,
      y: topY - rowHeight,
      width,
      height: rowHeight,
      color: isHeader ? COLORS.headerFill : COLORS.white,
      borderColor: isHeader ? COLORS.borderStrong : COLORS.border,
      borderWidth: isHeader ? 0.85 : 0.65,
    });

    const cellText = safeText(row[index] ?? headers[index] ?? "");
    const lines = wrapText(font, cellText, size, Math.max(10, width - paddingX * 2));
    let textY = topY - paddingY;
    lines.forEach((line) => {
      if (line) {
        page.drawText(line, {
          x: x + paddingX,
          y: textY - size,
          size,
          font,
          color: COLORS.text,
        });
      }
      textY -= lineHeight;
    });

    x += width;
  });

  return rowHeight;
}

function ensureSpace(params: {
  doc: PDFDocument;
  cursor: PdfCursor;
  requiredHeight: number;
}): PdfCursor {
  const { doc, cursor, requiredHeight } = params;
  if (cursor.y - requiredHeight >= contentBottomY()) return cursor;

  const page = createPage(doc);
  return {
    page,
    pageNumber: cursor.pageNumber + 1,
    y: contentTopY(),
  };
}

function drawSectionTitle(params: {
  doc: PDFDocument;
  cursor: PdfCursor;
  sectionTitle: string;
  boldFont: PDFFont;
}): PdfCursor {
  let cursor = ensureSpace({
    doc: params.doc,
    cursor: params.cursor,
    requiredHeight: 36,
  });
  const style: TextStyle = {
    font: params.boldFont,
    size: FONTS.h1,
    color: COLORS.heading,
    lineHeight: 22,
  };
  const used = drawWrappedText({
    page: cursor.page,
    text: params.sectionTitle,
    x: PAGE.marginLeft,
    y: cursor.y,
    width: availableWidth(),
    style,
  });
  return {
    ...cursor,
    y: cursor.y - used - 10,
  };
}

function drawParagraphs(params: {
  doc: PDFDocument;
  cursor: PdfCursor;
  paragraphs: string[];
  regularFont: PDFFont;
}): PdfCursor {
  let cursor = params.cursor;
  const style: TextStyle = {
    font: params.regularFont,
    size: FONTS.body,
    color: COLORS.text,
    lineHeight: 15.4,
  };

  for (const paragraph of params.paragraphs) {
    const text = normalizeText(paragraph);
    if (!text) continue;
    const estimated =
      textHeight(
        wrapText(style.font, text, style.size, availableWidth()).length,
        style.lineHeight
      ) + 8;
    cursor = ensureSpace({
      doc: params.doc,
      cursor,
      requiredHeight: estimated,
    });
    const used = drawWrappedText({
      page: cursor.page,
      text,
      x: PAGE.marginLeft,
      y: cursor.y,
      width: availableWidth(),
      style,
    });
    cursor = { ...cursor, y: cursor.y - used - 7 };
  }

  return cursor;
}

function drawBullets(params: {
  doc: PDFDocument;
  cursor: PdfCursor;
  bullets: string[];
  regularFont: PDFFont;
  boldFont: PDFFont;
}): PdfCursor {
  let cursor = params.cursor;
  const bulletIndent = 14;
  const style: TextStyle = {
    font: params.regularFont,
    size: FONTS.body,
    color: COLORS.text,
    lineHeight: 15.2,
  };

  for (const bullet of params.bullets) {
    const text = normalizeText(bullet);
    if (!text) continue;
    const width = availableWidth() - bulletIndent;
    const estimated =
      textHeight(
        wrapText(style.font, text, style.size, width).length,
        style.lineHeight
      ) + 4;
    cursor = ensureSpace({
      doc: params.doc,
      cursor,
      requiredHeight: estimated,
    });

    cursor.page.drawText("•", {
      x: PAGE.marginLeft + 1,
      y: cursor.y - style.size,
      size: style.size,
      font: params.boldFont,
      color: COLORS.text,
    });

    const used = drawWrappedText({
      page: cursor.page,
      text,
      x: PAGE.marginLeft + bulletIndent,
      y: cursor.y,
      width,
      style,
    });
    cursor = { ...cursor, y: cursor.y - used - 3 };
  }

  return cursor;
}

function drawTable(params: {
  doc: PDFDocument;
  cursor: PdfCursor;
  table: TableModel;
  regularFont: PDFFont;
  boldFont: PDFFont;
}): PdfCursor {
  let cursor = params.cursor;

  if (params.table.title) {
    const titleStyle: TextStyle = {
      font: params.boldFont,
      size: FONTS.h2,
      color: COLORS.heading,
      lineHeight: 17,
    };
    const estimated =
      textHeight(
        wrapText(
          titleStyle.font,
          params.table.title,
          titleStyle.size,
          availableWidth()
        ).length,
        titleStyle.lineHeight
      ) + 8;
    cursor = ensureSpace({
      doc: params.doc,
      cursor,
      requiredHeight: estimated,
    });
    const used = drawWrappedText({
      page: cursor.page,
      text: params.table.title,
      x: PAGE.marginLeft,
      y: cursor.y,
      width: availableWidth(),
      style: titleStyle,
    });
    cursor = { ...cursor, y: cursor.y - used - 6 };
  }

  const tableX = PAGE.marginLeft;
  const tableWidth = availableWidth();
  const widths = computeColumnWidths(tableWidth, params.table.headers);
  const headerEstimate = 34;
  cursor = ensureSpace({
    doc: params.doc,
    cursor,
    requiredHeight: headerEstimate,
  });

  const drawHeader = (at: PdfCursor): PdfCursor => {
    const used = drawTableRow({
      page: at.page,
      topY: at.y,
      headers: params.table.headers,
      row: params.table.headers,
      widths,
      isHeader: true,
      regularFont: params.regularFont,
      boldFont: params.boldFont,
      tableX,
    });
    return { ...at, y: at.y - used };
  };

  cursor = drawHeader(cursor);

  const rows =
    params.table.rows.length > 0
      ? params.table.rows
      : [
          Array.from({ length: params.table.headers.length }, (_, index) =>
            index === 0 ? "—" : ""
          ),
        ];

  for (const rawRow of rows) {
    const row = params.table.headers.map((_, index) => safeText(rawRow[index] ?? ""));
    const rowHeight = tableRowHeight({
      font: params.regularFont,
      size: FONTS.tableBody,
      lineHeight: 11.3,
      row,
      widths,
      paddingX: 7,
      paddingY: 6,
    });

    if (cursor.y - rowHeight < contentBottomY()) {
      cursor = {
        page: createPage(params.doc),
        pageNumber: cursor.pageNumber + 1,
        y: contentTopY(),
      };
      cursor = drawHeader(cursor);
    }

    const used = drawTableRow({
      page: cursor.page,
      topY: cursor.y,
      headers: params.table.headers,
      row,
      widths,
      isHeader: false,
      regularFont: params.regularFont,
      boldFont: params.boldFont,
      tableX,
    });
    cursor = { ...cursor, y: cursor.y - used };
  }

  return { ...cursor, y: cursor.y - 10 };
}

async function tryEmbedLogo(doc: PDFDocument, logoPath?: string) {
  if (!logoPath) return null;

  try {
    const bytes = await readFile(logoPath);
    const extension = extname(logoPath).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") {
      return doc.embedJpg(bytes);
    }
    return doc.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawPageNumber(params: {
  page: PDFPage;
  pageIndex: number;
  totalPages: number;
  regularFont: PDFFont;
}): void {
  const label = `${params.pageIndex} / ${params.totalPages}`;
  const size = 8.5;
  const width = measureText(params.regularFont, label, size);
  params.page.drawText(label, {
    x: PAGE.width - PAGE.marginRight - width,
    y: 20,
    size,
    font: params.regularFont,
    color: COLORS.muted,
  });
}

async function drawCoverPage(params: {
  doc: PDFDocument;
  page: PDFPage;
  report: StandardDiagnosticReport;
  preview: PreviewDiagnosticReport;
  regularFont: PDFFont;
  boldFont: PDFFont;
  logoPath?: string;
}): Promise<void> {
  const { doc, page, report, preview, regularFont, boldFont, logoPath } = params;
  const logo = await tryEmbedLogo(doc, logoPath);

  let y = PAGE.height - 68;

  if (logo) {
    const logoWidth = 170;
    const ratio = logo.height / logo.width;
    const logoHeight = logoWidth * ratio;
    page.drawImage(logo, {
      x: PAGE.marginLeft,
      y: y - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });
    y -= logoHeight + 22;
  }

  page.drawText("Greiner Consulting", {
    x: PAGE.marginLeft,
    y: y - FONTS.coverKicker,
    size: FONTS.coverKicker,
    font: boldFont,
    color: COLORS.heading,
  });
  y -= 40;

  y -=
    drawWrappedText({
      page,
      text: report.title,
      x: PAGE.marginLeft,
      y,
      width: availableWidth(),
      style: {
        font: boldFont,
        size: FONTS.coverTitle,
        color: COLORS.heading,
        lineHeight: 38,
      },
    }) + 12;

  const metaStyle: TextStyle = {
    font: regularFont,
    size: 11.2,
    color: COLORS.text,
    lineHeight: 16,
  };

  const metaLines = [
    `Entreprise : ${report.identificationPage.companyLabel}`,
    `Dirigeant : ${report.identificationPage.dirigeantLabel}`,
    `Date de génération : ${report.generatedAt}`,
  ];

  for (const metaLine of metaLines) {
    const used = drawWrappedText({
      page,
      text: metaLine,
      x: PAGE.marginLeft,
      y,
      width: availableWidth(),
      style: metaStyle,
    });
    y -= used + 2;
  }

  y -= 16;
  drawRule(page, y);
  y -= 24;

  y -=
    drawWrappedText({
      page,
      text: report.identificationPage.note,
      x: PAGE.marginLeft,
      y,
      width: availableWidth(),
      style: {
        font: regularFont,
        size: FONTS.body,
        color: COLORS.text,
        lineHeight: 15.4,
      },
    }) + 24;

  page.drawText("Sommaire du rapport", {
    x: PAGE.marginLeft,
    y: y - FONTS.h1,
    size: FONTS.h1,
    font: boldFont,
    color: COLORS.heading,
  });
  y -= 26;

  preview.sections.forEach((section, index) => {
    const line = `${index + 1}. ${section.title}`;
    page.drawText(line, {
      x: PAGE.marginLeft,
      y: y - FONTS.body,
      size: FONTS.body,
      font: regularFont,
      color: COLORS.text,
    });
    y -= 16.5;
  });
}

function previewSections(report: StandardDiagnosticReport): PreviewSection[] {
  return buildPreviewDiagnosticReport(report).sections;
}

export async function buildDiagnosticPdfBuffer(
  report: StandardDiagnosticReport,
  options: PdfBuilderOptions = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(report.title);
  doc.setCreator("ChatGPT");
  doc.setProducer("Greiner Consulting - Bilan de Santé");
  doc.setLanguage("fr-FR");

  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const cover = createPage(doc);
  const preview = buildPreviewDiagnosticReport(report);
  await drawCoverPage({
    doc,
    page: cover,
    report,
    preview,
    regularFont,
    boldFont,
    logoPath: options.logoPath,
  });

  let cursor: PdfCursor = {
    page: createPage(doc),
    y: contentTopY(),
    pageNumber: 2,
  };

  for (const section of previewSections(report)) {
    cursor = drawSectionTitle({
      doc,
      cursor,
      sectionTitle: section.title,
      boldFont,
    });

    cursor = drawParagraphs({
      doc,
      cursor,
      paragraphs: section.paragraphs ?? [],
      regularFont,
    });

    cursor = drawBullets({
      doc,
      cursor,
      bullets: section.bullets ?? [],
      regularFont,
      boldFont,
    });

    for (const table of section.tables ?? []) {
      cursor = drawTable({
        doc,
        cursor,
        table: {
          title: table.title,
          headers: table.headers,
          rows: table.rows,
        },
        regularFont,
        boldFont,
      });
    }

    cursor = ensureSpace({ doc, cursor, requiredHeight: 24 });
    drawRule(cursor.page, cursor.y - 4);
    cursor = { ...cursor, y: cursor.y - 24 };
  }

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    drawPageNumber({
      page,
      pageIndex: index + 1,
      totalPages: pages.length,
      regularFont,
    });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

export default buildDiagnosticPdfBuffer;
