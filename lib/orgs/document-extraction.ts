import "server-only";

import { createHash } from "node:crypto";

import mammoth from "mammoth";

import {
  KNOWLEDGE_MAX_PASSAGES_PER_SECTION,
  KNOWLEDGE_MAX_PASSAGES_TOTAL,
  KNOWLEDGE_MAX_SECTIONS,
  KNOWLEDGE_PASSAGE_BODY_MAX,
  KNOWLEDGE_SECTION_TITLE_MAX,
  type CanonicalKnowledgeSection,
} from "@/lib/orgs/knowledge-validation";
import type {
  ExtractedDocument,
  ValidatedDocument,
} from "@/lib/orgs/document-types";

export class DocumentExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentExtractionError";
  }
}

export async function extractDocument(
  document: ValidatedDocument,
): Promise<ExtractedDocument> {
  let sections: CanonicalKnowledgeSection[];
  if (document.kind === "pdf") {
    sections = await extractPdf(document.bytes);
  } else if (document.kind === "docx") {
    sections = await extractDocx(document.bytes);
  } else {
    sections = extractTxt(document.bytes);
  }
  assertCanonicalBounds(sections);
  return {
    sections,
    sourceSha256: sha256(document.bytes),
    contentSha256: checksumSections(sections),
  };
}

/** Hard cap aligned with knowledge section limits — fail before iterating. */
export const DOCUMENT_PDF_MAX_PAGES = KNOWLEDGE_MAX_SECTIONS;

export async function extractPdf(
  bytes: Uint8Array,
): Promise<CanonicalKnowledgeSection[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
  });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > DOCUMENT_PDF_MAX_PAGES) {
      throw new DocumentExtractionError(
        `PDFs may have at most ${DOCUMENT_PDF_MAX_PAGES} pages for knowledge extraction.`,
      );
    }
    const sections: CanonicalKnowledgeSection[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let current = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) {
          continue;
        }
        current += `${current && !/^\s/.test(item.str) ? " " : ""}${item.str}`;
        if (item.hasEOL) {
          if (normalizeText(current)) {
            lines.push(normalizeText(current));
          }
          current = "";
        }
      }
      if (normalizeText(current)) {
        lines.push(normalizeText(current));
      }
      const body = lines.join("\n").trim();
      if (!body) {
        continue;
      }
      sections.push(
        makeSection(
          `pdf_p${pad(pageNumber)}`,
          `Page ${pageNumber}`,
          splitPassage(body).map((chunk, index) => ({
            citationKey: `pdf_p${pad(pageNumber)}_t${pad(index + 1)}`,
            body: chunk,
          })),
        ),
      );
      if (sections.length >= KNOWLEDGE_MAX_SECTIONS) {
        break;
      }
    }
    if (sections.length === 0) {
      throw new DocumentExtractionError(
        "The PDF contains no extractable text. Scanned PDFs require OCR.",
      );
    }
    return sections;
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }
    throw new DocumentExtractionError("Could not extract text from the PDF.", {
      cause: error,
    });
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractDocx(
  bytes: Uint8Array,
): Promise<CanonicalKnowledgeSection[]> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
        ],
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    );
    html = result.value;
  } catch (error) {
    throw new DocumentExtractionError("Could not extract the DOCX document.", {
      cause: error,
    });
  }

  const blocks =
    html.match(
      /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>|<p\b[^>]*>[\s\S]*?<\/p>|<table\b[^>]*>[\s\S]*?<\/table>/gi,
    ) ?? [];
  const builder = new SectionBuilder("docx");
  for (const block of blocks) {
    if (/^<h[1-6]\b/i.test(block)) {
      builder.heading(htmlText(block));
    } else if (/^<table\b/i.test(block)) {
      const rows = block.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
      const rendered = rows
        .map((row) => {
          const cells = row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
          return cells.map(htmlText).filter(Boolean).join(" | ");
        })
        .filter(Boolean)
        .join("\n");
      builder.passage(rendered);
    } else {
      builder.passage(htmlText(block));
    }
  }
  return builder.finish();
}

export function extractTxt(bytes: Uint8Array): CanonicalKnowledgeSection[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new DocumentExtractionError("TXT extraction requires valid UTF-8.", {
      cause: error,
    });
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const builder = new SectionBuilder("txt");
  let paragraph: string[] = [];
  const flush = () => {
    builder.passage(paragraph.join("\n"));
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const atx = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const next = lines[index + 1] ?? "";
    const setext = line.trim() && /^\s*(?:={3,}|-{3,})\s*$/.test(next);
    if (atx || setext) {
      flush();
      builder.heading(atx?.[1] ?? line);
      if (setext) {
        index += 1;
      }
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return builder.finish();
}

export function checksumSections(
  sections: CanonicalKnowledgeSection[],
): string {
  return sha256(Buffer.from(JSON.stringify(sections), "utf8"));
}

class SectionBuilder {
  private sections: Array<{ title: string; bodies: string[] }> = [];
  private current: { title: string; bodies: string[] } | undefined;

  constructor(private readonly prefix: "docx" | "txt") {}

  heading(raw: string): void {
    const title = normalizeText(raw);
    if (!title) {
      return;
    }
    this.current = {
      title: title.slice(0, KNOWLEDGE_SECTION_TITLE_MAX),
      bodies: [],
    };
    this.sections.push(this.current);
  }

  passage(raw: string): void {
    const body = normalizeMultiline(raw);
    if (!body) {
      return;
    }
    if (!this.current) {
      this.heading("Document");
    }
    this.current!.bodies.push(...splitPassage(body));
  }

  finish(): CanonicalKnowledgeSection[] {
    const populated = this.sections.filter((section) => section.bodies.length);
    if (populated.length === 0) {
      throw new DocumentExtractionError(
        "The document contains no extractable text.",
      );
    }
    return populated.map((section, sectionIndex) => {
      const sectionKey = `${this.prefix}_s${pad(sectionIndex + 1)}`;
      return makeSection(
        sectionKey,
        section.title,
        section.bodies.map((body, passageIndex) => ({
          citationKey: `${sectionKey}_p${pad(passageIndex + 1)}`,
          body,
        })),
      );
    });
  }
}

function makeSection(
  citationKey: string,
  title: string,
  passages: CanonicalKnowledgeSection["passages"],
): CanonicalKnowledgeSection {
  return {
    citationKey,
    title: normalizeText(title).slice(0, KNOWLEDGE_SECTION_TITLE_MAX),
    passages,
  };
}

function splitPassage(raw: string): string[] {
  const value = normalizeMultiline(raw);
  if (value.length <= KNOWLEDGE_PASSAGE_BODY_MAX) {
    return value ? [value] : [];
  }
  const chunks: string[] = [];
  let remaining = value;
  while (remaining) {
    let end = Math.min(KNOWLEDGE_PASSAGE_BODY_MAX, remaining.length);
    if (end < remaining.length) {
      const boundary = Math.max(
        remaining.lastIndexOf("\n", end),
        remaining.lastIndexOf(" ", end),
      );
      if (boundary >= Math.floor(KNOWLEDGE_PASSAGE_BODY_MAX * 0.75)) {
        end = boundary;
      }
    }
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return chunks.filter(Boolean);
}

function assertCanonicalBounds(sections: CanonicalKnowledgeSection[]): void {
  const passages = sections.reduce(
    (total, section) => total + section.passages.length,
    0,
  );
  if (
    sections.length > KNOWLEDGE_MAX_SECTIONS ||
    passages > KNOWLEDGE_MAX_PASSAGES_TOTAL ||
    sections.some(
      (section) => section.passages.length > KNOWLEDGE_MAX_PASSAGES_PER_SECTION,
    )
  ) {
    throw new DocumentExtractionError(
      "The extracted document exceeds knowledge content limits.",
    );
  }
}

function htmlText(html: string): string {
  return normalizeMultiline(
    decodeEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      }
      if (lower.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      }
      return (
        {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        }[lower] ?? match
      );
    },
  );
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pad(value: number): string {
  return String(value).padStart(4, "0");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
