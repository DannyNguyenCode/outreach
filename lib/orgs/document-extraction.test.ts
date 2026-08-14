import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  checksumSections,
  extractDocument,
  extractDocx,
  extractPdf,
  extractTxt,
} from "@/lib/orgs/document-extraction";

describe("deterministic document extraction", () => {
  it("extracts TXT headings and paragraphs with stable citation keys", () => {
    const bytes = new TextEncoder().encode(
      "Intro paragraph.\r\n\r\n# Returns\r\nReturn within 30 days.\r\nReceipt required.",
    );
    const first = extractTxt(bytes);
    const second = extractTxt(bytes);

    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        citationKey: "txt_s0001",
        title: "Document",
        passages: [
          { citationKey: "txt_s0001_p0001", body: "Intro paragraph." },
        ],
      },
      {
        citationKey: "txt_s0002",
        title: "Returns",
        passages: [
          {
            citationKey: "txt_s0002_p0001",
            body: "Return within 30 days.\nReceipt required.",
          },
        ],
      },
    ]);
    expect(checksumSections(first)).toBe(checksumSections(second));
  });

  it("extracts DOCX headings, paragraphs, and tables deterministically", async () => {
    const bytes = await makeExtractableDocx();
    const first = await extractDocx(bytes);
    const second = await extractDocx(bytes);

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      citationKey: "docx_s0001",
      title: "Returns",
    });
    expect(first[0]?.passages.map((passage) => passage.body)).toEqual([
      "Returns are accepted for 30 days.",
      "Window | Fee\n30 days | None",
    ]);
  });

  it("extracts text by PDF page with page-based citations", async () => {
    const sections = await extractPdf(makePdf("Hello PDF policy"));
    expect(sections).toEqual([
      {
        citationKey: "pdf_p0001",
        title: "Page 1",
        passages: [
          {
            citationKey: "pdf_p0001_t0001",
            body: "Hello PDF policy",
          },
        ],
      },
    ]);
  });

  it("rejects PDFs that exceed the page cap before iterating pages", async () => {
    await expect(extractPdf(makePdf("too many", 41))).rejects.toThrow(
      /at most 40 pages/i,
    );
  });

  it("returns source and canonical checksums", async () => {
    const bytes = new TextEncoder().encode("# Policy\n\nKeep receipts.");
    const extracted = await extractDocument({
      bytes,
      kind: "txt",
      filename: "policy.txt",
      mimeType: "text/plain",
      byteLength: bytes.byteLength,
      sha256: "0".repeat(64),
    });

    expect(extracted.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(extracted.contentSha256).toBe(checksumSections(extracted.sections));
  });
});

async function makeExtractableDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    </Types>`,
  );
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="paragraph" w:styleId="Heading1">
        <w:name w:val="heading 1"/>
      </w:style>
    </w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Returns</w:t></w:r></w:p>
        <w:p><w:r><w:t>Returns are accepted for 30 days.</w:t></w:r></w:p>
        <w:tbl>
          <w:tr><w:tc><w:p><w:r><w:t>Window</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Fee</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>30 days</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>None</w:t></w:r></w:p></w:tc></w:tr>
        </w:tbl>
      </w:body>
    </w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function makePdf(text: string, pageCount = 1): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const kids = Array.from({ length: pageCount }, () => "3 0 R").join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}
