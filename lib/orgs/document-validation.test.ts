import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DOCUMENT_MAX_BYTES } from "@/lib/orgs/document-types";
import {
  DocumentValidationError,
  sanitizeDocumentFilename,
  validateDocument,
} from "@/lib/orgs/document-validation";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("document validation", () => {
  it("accepts UTF-8 TXT and returns a sanitized name and checksum", async () => {
    const result = await validateDocument({
      bytes: new TextEncoder().encode("Returns are accepted within 30 days."),
      filename: "../Policy<>.TXT",
      declaredMimeType: "text/plain; charset=utf-8",
    });

    expect(result.kind).toBe("txt");
    expect(result.filename).toBe("Policy__.txt");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsupported, mismatched, empty, and oversized inputs", async () => {
    await expect(
      validateDocument({
        bytes: new Uint8Array(),
        filename: "empty.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "empty" });
    await expect(
      validateDocument({
        bytes: new TextEncoder().encode("text"),
        filename: "policy.pdf",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
    await expect(
      validateDocument({
        bytes: new Uint8Array(DOCUMENT_MAX_BYTES + 1),
        filename: "large.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("requires a PDF signature and rejects appended polyglot data", async () => {
    const pdf = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
    );
    await expect(
      validateDocument({
        bytes: pdf,
        filename: "policy.pdf",
        declaredMimeType: "application/pdf",
      }),
    ).resolves.toMatchObject({ kind: "pdf" });

    await expect(
      validateDocument({
        bytes: new TextEncoder().encode(
          "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\nPK\u0003\u0004",
        ),
        filename: "policy.pdf",
        declaredMimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "polyglot" });
    await expect(
      validateDocument({
        bytes: new TextEncoder().encode("%PDF-1.7\n/Encrypt 2 0 R\n%%EOF"),
        filename: "secret.pdf",
        declaredMimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "encrypted" });
  });

  it("rejects invalid UTF-8 and NUL-heavy TXT", async () => {
    await expect(
      validateDocument({
        bytes: Uint8Array.of(0xff, 0xfe, 0xfd),
        filename: "binary.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "binary_text" });
    await expect(
      validateDocument({
        bytes: new TextEncoder().encode("hello\u0000world"),
        filename: "binary.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "binary_text" });
  });

  it("accepts a structurally valid DOCX", async () => {
    const bytes = await makeDocx();
    await expect(
      validateDocument({
        bytes,
        filename: "policy.docx",
        declaredMimeType: DOCX_MIME,
      }),
    ).resolves.toMatchObject({ kind: "docx", mimeType: DOCX_MIME });
  });

  it("rejects DOCX macros, nesting, malformed packages, and ZIP bombs", async () => {
    await expect(
      validateDocument({
        bytes: await makeDocx({
          "word/vbaProject.bin": Uint8Array.of(1, 2, 3),
        }),
        filename: "macro.docx",
        declaredMimeType: DOCX_MIME,
      }),
    ).rejects.toMatchObject({ code: "macros" });

    await expect(
      validateDocument({
        bytes: await makeDocx({
          "word/media/archive.bin": Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
        }),
        filename: "nested.docx",
        declaredMimeType: DOCX_MIME,
      }),
    ).rejects.toMatchObject({ code: "polyglot" });

    await expect(
      validateDocument({
        bytes: Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3),
        filename: "broken.docx",
        declaredMimeType: DOCX_MIME,
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);

    await expect(
      validateDocument({
        bytes: await makeDocx({
          "word/huge.txt": "a".repeat(2 * 1024 * 1024),
        }),
        filename: "bomb.docx",
        declaredMimeType: DOCX_MIME,
      }),
    ).rejects.toMatchObject({ code: "zip_bomb" });
  });

  it("normalizes path names and protects Windows device names", () => {
    expect(sanitizeDocumentFilename("C:\\fakepath\\CON.txt")).toBe("_CON.txt");
    expect(() => sanitizeDocumentFilename("..")).toThrow(
      DocumentValidationError,
    );
  });
});

async function makeDocx(
  extras: Record<string, string | Uint8Array> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Policy</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  for (const [name, value] of Object.entries(extras)) {
    zip.file(name, value);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
