import "server-only";

import { SaxesParser, type SaxesTagNS } from "saxes";

import {
  enforceTabularDeadline,
  invalid,
  TabularValidationError,
} from "@/lib/orgs/tabular-helpers";

export const OOXML_NS = {
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  spreadsheetml: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  relationships: "http://schemas.openxmlformats.org/package/2006/relationships",
  officeRel:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
} as const;

export const TABULAR_XML_MAX_DEPTH = 32;

const PREDEFINED_ENTITIES: Record<string, string> = Object.freeze({
  amp: "&",
  gt: ">",
  lt: "<",
  quot: '"',
  apos: "'",
});

export type OoxmlName = {
  localName: string;
  namespace: string;
};

export type OoxmlAttr = {
  localName: string;
  namespace: string;
  value: string;
};

export function ooxmlAttr(
  attrs: readonly OoxmlAttr[],
  localName: string,
  namespace = "",
): string {
  for (const attr of attrs) {
    if (attr.localName === localName && attr.namespace === namespace) {
      return attr.value;
    }
  }
  return "";
}

export function parseOoxmlDocument(options: {
  xml: string;
  rootLocalName: string;
  rootNamespace: string;
  started: number;
  onOpen?: (
    name: OoxmlName,
    attrs: readonly OoxmlAttr[],
    path: readonly OoxmlName[],
  ) => void;
  onClose?: (name: OoxmlName, text: string, path: readonly OoxmlName[]) => void;
}): void {
  rejectProhibitedXmlDeclarations(options.xml);
  const parser = new SaxesParser({
    xmlns: true,
    fragment: false,
    position: false,
  });
  parser.ENTITIES = Object.create(null) as Record<string, string>;
  Object.assign(parser.ENTITIES, PREDEFINED_ENTITIES);
  Object.freeze(parser.ENTITIES);

  const stack: Array<OoxmlName & { text: string }> = [];
  let sawRoot = false;
  let closedRoot = false;
  let events = 0;

  const bump = (): void => {
    events += 1;
    if (events % 256 === 0) {
      enforceTabularDeadline(options.started);
    }
  };

  parser.on("error", () => {
    throw malformedXml();
  });
  parser.on("doctype", () => {
    throw prohibitedXml();
  });
  parser.on("opentag", (tag: SaxesTagNS) => {
    bump();
    if (closedRoot) {
      throw malformedXml();
    }
    if (stack.length >= TABULAR_XML_MAX_DEPTH) {
      throw malformedXml();
    }
    const name: OoxmlName = {
      localName: tag.local,
      namespace: tag.uri,
    };
    if (stack.length === 0) {
      if (sawRoot) {
        throw malformedXml();
      }
      sawRoot = true;
      if (
        name.localName !== options.rootLocalName ||
        name.namespace !== options.rootNamespace
      ) {
        throw malformedXml();
      }
    }
    stack.push({ ...name, text: "" });
    options.onOpen?.(name, collectAttrs(tag), stack);
  });
  parser.on("closetag", (tag: SaxesTagNS) => {
    bump();
    const current = stack.pop();
    if (
      !current ||
      current.localName !== tag.local ||
      current.namespace !== tag.uri
    ) {
      throw malformedXml();
    }
    options.onClose?.(
      { localName: current.localName, namespace: current.namespace },
      current.text,
      [...stack, current],
    );
    if (stack.length === 0) {
      closedRoot = true;
    }
  });
  parser.on("text", (text) => {
    bump();
    appendText(stack, text);
  });
  parser.on("cdata", (text) => {
    bump();
    appendText(stack, text);
  });

  try {
    parser.write(stripBom(options.xml));
    parser.close();
  } catch (error) {
    if (error instanceof TabularValidationError) {
      throw error;
    }
    throw malformedXml();
  }

  if (!sawRoot || !closedRoot || stack.length !== 0) {
    throw malformedXml();
  }
}

function collectAttrs(tag: SaxesTagNS): OoxmlAttr[] {
  const attrs: OoxmlAttr[] = [];
  for (const attr of Object.values(tag.attributes)) {
    if (attr.prefix === "xmlns" || attr.name === "xmlns") {
      continue;
    }
    attrs.push({
      localName: attr.local,
      namespace: attr.uri,
      value: attr.value,
    });
  }
  return attrs;
}

function appendText(
  stack: Array<OoxmlName & { text: string }>,
  text: string,
): void {
  if (stack.length > 0) {
    stack[stack.length - 1]!.text += text;
    return;
  }
  if (text.trim() !== "") {
    throw malformedXml();
  }
}

function stripBom(xml: string): string {
  return xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
}

function rejectProhibitedXmlDeclarations(xml: string): void {
  let index = 0;
  while (index < xml.length) {
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index + 4);
      if (end < 0 || xml.slice(index + 4, end).includes("--")) {
        throw malformedXml();
      }
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", index)) {
      const end = xml.indexOf("]]>", index + 9);
      if (end < 0) {
        throw malformedXml();
      }
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<?", index)) {
      const end = xml.indexOf("?>", index + 2);
      if (end < 0) {
        throw malformedXml();
      }
      index = end + 2;
      continue;
    }
    if (xml.startsWith("<!", index)) {
      throw prohibitedXml();
    }
    if (xml[index] === "<") {
      index = skipXmlTag(xml, index);
      continue;
    }
    index += 1;
  }
}

function skipXmlTag(xml: string, start: number): number {
  let index = start + 1;
  let quote: '"' | "'" | null = null;
  while (index < xml.length) {
    const character = xml[index] ?? "";
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === ">") {
      return index + 1;
    }
    index += 1;
  }
  throw malformedXml();
}

function malformedXml(): Error {
  return invalid("malformed", "The spreadsheet XML is malformed.");
}

function prohibitedXml(): Error {
  return invalid(
    "malformed",
    "The spreadsheet XML contains prohibited declarations.",
  );
}
