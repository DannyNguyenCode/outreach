/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { TabularValidationError } from "@/lib/orgs/tabular-helpers";
import { parseOoxmlDocument } from "@/lib/orgs/tabular-xml";

function parse(xml: string, root = "worksheet") {
  return parseOoxmlDocument(xml, root, performance.now()).normalizedXml;
}

function expectMalformed(xml: string, root = "worksheet") {
  expect(() => parse(xml, root)).toThrow(TabularValidationError);
  try {
    parse(xml, root);
  } catch (error) {
    expect(error).toMatchObject({ code: "malformed" });
  }
}

describe("bounded OOXML document parser", () => {
  it("accepts one well-formed expected root and namespace-prefixed controls", () => {
    const plain = parse(
      `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData><row r="1"><c r="A1"/></row></sheetData>
      </worksheet>
      <!-- trailing comment -->
      <?pi trailing ?>`,
    );
    expect(plain).toContain("<worksheet");
    expect(plain).toContain("</worksheet>");
    expect(plain).not.toContain("trailing comment");

    const prefixed = parse(
      `<?xml version="1.0" encoding="UTF-8"?>
      <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:sheetData><x:c r="A1" t="inlineStr"><x:is><x:t>Widget</x:t></x:is></x:c></x:sheetData>
      </x:worksheet>`,
    );
    expect(prefixed).toContain("<x:worksheet");
    expect(prefixed).toContain("Widget");
  });

  it("rejects rootless, misrooted, multiple-root, trailing, and nested-malformed documents", () => {
    expectMalformed(
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row></sheetData>`,
    );
    expectMalformed(`<html><sheetData><c r="A1"/></sheetData></html>`);
    expectMalformed(
      `<worksheet><sheetData/></worksheet><worksheet><sheetData/></worksheet>`,
    );
    expectMalformed(
      `<worksheet><sheetData/></worksheet><sheetData><c r="A1"/></sheetData>`,
    );
    expectMalformed(`<worksheet><sheetData></worksheet></sheetData>`);
    expectMalformed(`<worksheet><sheetData/></worksheet>not-whitespace`);
  });

  it("rejects prohibited declarations, unmatched constructs, and unsafe names", () => {
    expectMalformed(`<?xml version="1.0"?><!DOCTYPE worksheet><worksheet/>`);
    expectMalformed(`<worksheet><![CDATA[before close]`);
    expectMalformed(`<worksheet><!-- unterminated`);
    expectMalformed(`<worksheet attr=unquoted></worksheet>`);
    expectMalformed(`<worksheet a="1" a="2"></worksheet>`);
    expectMalformed(`<worksheet>< :bad/></worksheet>`);
    expectMalformed(`<worksheet>]]>text</worksheet>`);
    expectMalformed(
      `<Relationships><Relationship Id="rId1"/></Relationships>`,
      "workbook",
    );
  });

  it("treats CDATA as character data and comments or PIs as non-elements", () => {
    const xml = parse(
      `<worksheet>
        <![CDATA[<sheetData><c r="A1"/></sheetData>]]>
        <?pi <sheetData/> ?>
        <!-- <sheetData/> -->
        <sheetData><c r="A1" t="inlineStr"><is><t>Ok</t></is></c></sheetData>
      </worksheet>`,
    );
    expect(xml).toContain("&lt;sheetData&gt;");
    expect(xml).toContain("<sheetData>");
    expect(xml).not.toContain("<![CDATA[");
    expect(xml).not.toContain("<?pi");
  });
});
