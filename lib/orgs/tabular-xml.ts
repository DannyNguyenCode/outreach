import "server-only";

import { enforceTabularDeadline, invalid } from "@/lib/orgs/tabular-helpers";

const MAX_XML_DEPTH = 32;
const MAX_ATTRIBUTE_COUNT = 64;
const MAX_NAME_LENGTH = 128;
const SCAN_CHECKPOINT = 4096;

const NAMED_ENTITIES = ["lt;", "gt;", "amp;", "quot;", "apos;"] as const;

export function parseOoxmlDocument(
  xml: string,
  expectedRootLocalName: string,
  started: number,
): { normalizedXml: string } {
  const parser = new BoundedOoxmlParser(xml, expectedRootLocalName, started);
  return { normalizedXml: parser.parse() };
}

class BoundedOoxmlParser {
  private index = 0;
  private scanned = 0;
  private readonly output: string[] = [];
  private readonly stack: string[] = [];
  private rootSeen = false;
  private rootClosed = false;

  constructor(
    private readonly xml: string,
    private readonly expectedRootLocalName: string,
    private readonly started: number,
  ) {}

  parse(): string {
    this.skipBom();
    if (this.startsWithXmlDeclaration()) {
      this.consumeXmlDeclaration();
    }

    while (this.index < this.xml.length) {
      this.checkpoint();
      if (this.xml.startsWith("<!--", this.index)) {
        this.consumeComment();
        continue;
      }
      if (this.xml.startsWith("<![CDATA[", this.index)) {
        this.consumeCdata();
        continue;
      }
      if (
        this.xml.startsWith("<!DOCTYPE", this.index) ||
        this.xml.startsWith("<!ENTITY", this.index)
      ) {
        throw this.malformed();
      }
      if (this.xml.startsWith("<!", this.index)) {
        throw this.malformed();
      }
      if (this.xml.startsWith("<?", this.index)) {
        this.consumeProcessingInstruction();
        continue;
      }
      if (this.xml.startsWith("</", this.index)) {
        this.consumeEndTag();
        continue;
      }
      if (this.peek() === "<") {
        this.consumeStartTag();
        continue;
      }
      this.consumeCharacterData();
    }

    if (!this.rootSeen || !this.rootClosed || this.stack.length > 0) {
      throw this.malformed();
    }
    return this.output.join("");
  }

  private startsWithXmlDeclaration(): boolean {
    return /^<\?xml(?:\s|\?)/i.test(this.xml.slice(this.index, this.index + 6));
  }

  private consumeXmlDeclaration(): void {
    const end = this.xml.indexOf("?>", this.index + 5);
    if (end < 0) {
      throw this.malformed();
    }
    this.index = end + 2;
  }

  private consumeComment(): void {
    const end = this.xml.indexOf("-->", this.index + 4);
    if (end < 0) {
      throw this.malformed();
    }
    const inner = this.xml.slice(this.index + 4, end);
    if (inner.includes("--") || inner.endsWith("-")) {
      throw this.malformed();
    }
    this.index = end + 3;
  }

  private consumeProcessingInstruction(): void {
    if (this.startsWithXmlDeclaration()) {
      throw this.malformed();
    }
    const end = this.xml.indexOf("?>", this.index + 2);
    if (end < 0) {
      throw this.malformed();
    }
    this.index = end + 2;
  }

  private consumeCdata(): void {
    if (this.stack.length === 0) {
      throw this.malformed();
    }
    const end = this.xml.indexOf("]]>", this.index + 9);
    if (end < 0) {
      throw this.malformed();
    }
    this.output.push(
      escapeXmlCharacterData(this.xml.slice(this.index + 9, end)),
    );
    this.index = end + 3;
  }

  private consumeStartTag(): void {
    if (this.rootClosed) {
      throw this.malformed();
    }
    this.index += 1;
    const qname = this.consumeName();
    const attributes = this.consumeAttributes();
    this.skipWhitespace();
    const selfClosing = this.peek() === "/";
    if (selfClosing) {
      this.index += 1;
      this.skipWhitespace();
    }
    if (this.peek() !== ">") {
      throw this.malformed();
    }
    this.index += 1;

    if (this.stack.length === 0) {
      if (this.rootSeen) {
        throw this.malformed();
      }
      if (
        qname.localName.toLowerCase() !==
        this.expectedRootLocalName.toLowerCase()
      ) {
        throw this.malformed();
      }
      this.rootSeen = true;
      if (selfClosing) {
        this.rootClosed = true;
      }
    } else if (this.stack.length >= MAX_XML_DEPTH) {
      throw this.malformed();
    }

    this.output.push("<", qname.name, attributes, selfClosing ? "/>" : ">");
    if (!selfClosing) {
      this.stack.push(qname.name);
    }
  }

  private consumeEndTag(): void {
    this.index += 2;
    const qname = this.consumeName();
    this.skipWhitespace();
    if (this.peek() !== ">") {
      throw this.malformed();
    }
    this.index += 1;
    const expected = this.stack.pop();
    if (!expected || expected !== qname.name) {
      throw this.malformed();
    }
    this.output.push("</", qname.name, ">");
    if (this.stack.length === 0) {
      this.rootClosed = true;
    }
  }

  private consumeAttributes(): string {
    const seen = new Set<string>();
    let rendered = "";
    let count = 0;
    while (this.index < this.xml.length) {
      const before = this.index;
      this.skipWhitespace();
      const next = this.peek();
      if (next === "" || next === "/" || next === ">") {
        return rendered;
      }
      if (this.index === before) {
        throw this.malformed();
      }
      if (count >= MAX_ATTRIBUTE_COUNT) {
        throw this.malformed();
      }
      const name = this.consumeName();
      if (seen.has(name.name)) {
        throw this.malformed();
      }
      seen.add(name.name);
      this.skipWhitespace();
      if (this.peek() !== "=") {
        throw this.malformed();
      }
      this.index += 1;
      this.skipWhitespace();
      const value = this.consumeQuotedValue();
      rendered += ` ${name.name}=${value}`;
      count += 1;
    }
    throw this.malformed();
  }

  private consumeQuotedValue(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      throw this.malformed();
    }
    this.index += 1;
    const start = this.index;
    while (this.index < this.xml.length) {
      const character = this.peek();
      if (character === quote) {
        const raw = this.xml.slice(start, this.index);
        this.index += 1;
        return `${quote}${raw}${quote}`;
      }
      if (character === "<") {
        throw this.malformed();
      }
      if (character === "&") {
        this.consumeEntity();
        continue;
      }
      this.assertLegalChar(character);
      this.index += 1;
    }
    throw this.malformed();
  }

  private consumeCharacterData(): void {
    const start = this.index;
    while (this.index < this.xml.length) {
      const character = this.peek();
      if (character === "<") {
        break;
      }
      if (this.xml.startsWith("]]>", this.index)) {
        throw this.malformed();
      }
      if (character === "&") {
        this.consumeEntity();
        continue;
      }
      if (this.stack.length === 0 && !isXmlWhitespace(character)) {
        throw this.malformed();
      }
      this.assertLegalChar(character);
      this.index += 1;
    }
    if (this.index === start) {
      throw this.malformed();
    }
    if (this.stack.length > 0) {
      this.output.push(this.xml.slice(start, this.index));
    }
  }

  private consumeEntity(): void {
    if (this.peek() !== "&") {
      throw this.malformed();
    }
    if (
      this.xml.startsWith("&#x", this.index) ||
      this.xml.startsWith("&#X", this.index)
    ) {
      let cursor = this.index + 3;
      if (!isHex(this.xml[cursor] ?? "")) {
        throw this.malformed();
      }
      while (isHex(this.xml[cursor] ?? "")) {
        cursor += 1;
      }
      if (this.xml[cursor] !== ";") {
        throw this.malformed();
      }
      const code = Number.parseInt(this.xml.slice(this.index + 3, cursor), 16);
      this.assertLegalCodePoint(code);
      this.index = cursor + 1;
      return;
    }
    if (this.xml.startsWith("&#", this.index)) {
      let cursor = this.index + 2;
      if (!isDigit(this.xml[cursor] ?? "")) {
        throw this.malformed();
      }
      while (isDigit(this.xml[cursor] ?? "")) {
        cursor += 1;
      }
      if (this.xml[cursor] !== ";") {
        throw this.malformed();
      }
      const code = Number.parseInt(this.xml.slice(this.index + 2, cursor), 10);
      this.assertLegalCodePoint(code);
      this.index = cursor + 1;
      return;
    }
    for (const entity of NAMED_ENTITIES) {
      if (this.xml.startsWith(`&${entity}`, this.index)) {
        this.index += entity.length + 1;
        return;
      }
    }
    throw this.malformed();
  }

  private consumeName(): { name: string; localName: string } {
    const start = this.index;
    if (!isNameStart(this.peek())) {
      throw this.malformed();
    }
    this.index += 1;
    while (isNameChar(this.peek())) {
      this.index += 1;
    }
    const name = this.xml.slice(start, this.index);
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw this.malformed();
    }
    const colon = name.indexOf(":");
    if (
      colon === 0 ||
      colon === name.length - 1 ||
      name.indexOf(":", colon + 1) !== -1
    ) {
      throw this.malformed();
    }
    return {
      name,
      localName: colon === -1 ? name : name.slice(colon + 1),
    };
  }

  private skipBom(): void {
    if (this.xml.startsWith("\uFEFF")) {
      this.index = 1;
    }
  }

  private skipWhitespace(): void {
    while (isXmlWhitespace(this.peek())) {
      this.index += 1;
    }
  }

  private peek(): string {
    return this.xml[this.index] ?? "";
  }

  private checkpoint(): void {
    this.scanned += 1;
    if (this.scanned % SCAN_CHECKPOINT === 0) {
      enforceTabularDeadline(this.started);
    }
  }

  private assertLegalChar(character: string): void {
    if (!character) {
      throw this.malformed();
    }
    this.assertLegalCodePoint(character.codePointAt(0) ?? 0);
  }

  private assertLegalCodePoint(code: number): void {
    if (
      !Number.isInteger(code) ||
      code === 0 ||
      (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code > 0x10ffff
    ) {
      throw this.malformed();
    }
  }

  private malformed(): Error {
    return invalid("malformed", "The spreadsheet XML is malformed.");
  }
}

function escapeXmlCharacterData(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isXmlWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function isNameStart(character: string): boolean {
  return /[A-Za-z_:]/.test(character);
}

function isNameChar(character: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(character);
}

function isHex(character: string): boolean {
  return /[0-9A-Fa-f]/.test(character);
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}
