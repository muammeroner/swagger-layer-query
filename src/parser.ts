import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ParsedMethodParam,
  ParsedServiceMethod,
  ParsedServiceModule,
} from "./types.js";
import { deriveTagFromServiceClass, toPascalCase } from "./utils.js";

const BUILTIN_TYPE_NAMES = new Set([
  "Promise",
  "Error",
  "Record",
  "Omit",
  "Partial",
  "Required",
  "Pick",
  "Readonly",
  "ReadonlyArray",
  "Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Date",
  "Blob",
  "File",
  "FormData",
  "Headers",
  "Response",
  "Request",
  "URL",
  "URLSearchParams",
  "AbortSignal",
  "Uint8Array",
  "ArrayBuffer",
  "Awaited",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "Exclude",
  "Extract",
  "UseQueryOptions",
  "UseMutationOptions",
]);

const OPEN_DELIMITERS = new Set(["{", "<", "(", "["]);
const CLOSE_DELIMITERS = new Set(["}", ">", ")", "]"]);
const STRING_QUOTES = new Set(['"', "'", "`"]);

export interface AvailableTypeSymbols {
  typesFilePath: string | null;
  typesSymbols: Set<string>;
  enumsFilePath: string | null;
  enumsSymbols: Set<string>;
}

function skipStringLiteral(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return src.length;
}

function skipComment(src: string, start: number): number {
  if (src[start] === "/" && src[start + 1] === "/") {
    let i = start + 2;
    while (i < src.length && src[i] !== "\n") i++;
    return i;
  }
  if (src[start] === "/" && src[start + 1] === "*") {
    let i = start + 2;
    while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
    return Math.min(i + 2, src.length);
  }
  return start;
}

function skipWhitespaceAndComments(src: string, start: number): number {
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const afterComment = skipComment(src, i);
    if (afterComment > i) {
      i = afterComment;
      continue;
    }
    break;
  }
  return i;
}

function findMatchingDelimiter(
  src: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let i = openIndex;

  while (i < src.length) {
    const ch = src[i];
    if (STRING_QUOTES.has(ch)) {
      i = skipStringLiteral(src, i);
      continue;
    }
    const afterComment = skipComment(src, i);
    if (afterComment > i) {
      i = afterComment;
      continue;
    }
    // Avoid treating arrow function `=>` as a closing angle bracket `>`
    if (openChar === "<" && ch === "=" && src[i + 1] === ">") {
      i += 2;
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }

  return -1;
}

function findTopLevelIndex(
  src: string,
  predicate: (ch: string, index: number, text: string) => boolean
): number {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (STRING_QUOTES.has(ch)) {
      i = skipStringLiteral(src, i) - 1;
      continue;
    }
    if (OPEN_DELIMITERS.has(ch)) {
      depth++;
    } else if (CLOSE_DELIMITERS.has(ch)) {
      depth--;
    } else if (depth === 0 && predicate(ch, i, src)) {
      return i;
    }
  }
  return -1;
}

function splitTopLevel(src: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (STRING_QUOTES.has(ch)) {
      i = skipStringLiteral(src, i) - 1;
      continue;
    }
    if (OPEN_DELIMITERS.has(ch)) {
      depth++;
    } else if (CLOSE_DELIMITERS.has(ch)) {
      depth--;
    } else if (depth === 0 && ch === separator) {
      const slice = src.slice(start, i).trim();
      if (slice) parts.push(slice);
      start = i + 1;
    }
  }

  const tail = src.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseSingleParam(raw: string): ParsedMethodParam {
  const cleaned = raw.replace(/^(?:public|private|protected|readonly)\s+/, "");
  const colonIdx = findTopLevelIndex(cleaned, (ch) => ch === ":");

  if (colonIdx === -1) {
    const eqIdx = cleaned.indexOf("=");
    const nameOnly = (eqIdx === -1 ? cleaned : cleaned.slice(0, eqIdx)).trim();
    return {
      name: nameOnly.replace(/\?$/, ""),
      optional: nameOnly.endsWith("?") || eqIdx !== -1,
      type: "unknown",
    };
  }

  const namePart = cleaned.slice(0, colonIdx).trim();
  const rawTypePart = cleaned.slice(colonIdx + 1).trim();
  const defaultIdx = findTopLevelIndex(
    rawTypePart,
    (ch, idx, text) => ch === "=" && text[idx + 1] !== ">" && text[idx - 1] !== "="
  );

  const hasDefault = defaultIdx !== -1;
  const type = (hasDefault ? rawTypePart.slice(0, defaultIdx) : rawTypePart).trim() || "unknown";

  return {
    name: namePart.replace(/\?$/, ""),
    optional: namePart.endsWith("?") || hasDefault,
    type,
  };
}

export function parseMethodParams(paramStr: string): ParsedMethodParam[] {
  if (!paramStr || !paramStr.trim()) return [];
  return splitTopLevel(paramStr, ",").map(parseSingleParam);
}

function isQueryMethod(fnName: string, queryMethodPrefixes: string[]): boolean {
  const lower = fnName.toLowerCase();
  return queryMethodPrefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function extractServiceClassBody(
  content: string
): { serviceClassName: string; body: string } | null {
  const classMatch = /export\s+class\s+(\w+Service)\b[^{]*\{/.exec(content);
  if (!classMatch) return null;

  const openBrace = classMatch.index + classMatch[0].length - 1;
  const closeBrace = findMatchingDelimiter(content, openBrace, "{", "}");
  if (closeBrace === -1) return null;

  return {
    serviceClassName: classMatch[1],
    body: content.slice(openBrace + 1, closeBrace),
  };
}

function skipClassField(body: string, start: number): number {
  let cursor = start;
  while (cursor < body.length && body[cursor] !== ";" && body[cursor] !== "\n") {
    if (body[cursor] === "{") {
      const end = findMatchingDelimiter(body, cursor, "{", "}");
      return end === -1 ? body.length : end + 1;
    }
    cursor++;
  }
  return cursor + 1;
}

function parsePromiseReturnType(
  body: string,
  colonIndex: number
): { returnType: string | null; nextCursor: number } {
  let cursor = skipWhitespaceAndComments(body, colonIndex + 1);

  if (body.slice(cursor).startsWith("Promise")) {
    const afterPromise = skipWhitespaceAndComments(body, cursor + "Promise".length);
    if (body[afterPromise] === "<") {
      const angleEnd = findMatchingDelimiter(body, afterPromise, "<", ">");
      if (angleEnd !== -1) {
        return {
          returnType: body.slice(afterPromise + 1, angleEnd).trim(),
          nextCursor: skipWhitespaceAndComments(body, angleEnd + 1),
        };
      }
    }
  }

  while (cursor < body.length && body[cursor] !== "{" && body[cursor] !== ";") {
    if (body[cursor] === "<") {
      const end = findMatchingDelimiter(body, cursor, "<", ">");
      cursor = end === -1 ? body.length : end + 1;
      continue;
    }
    cursor++;
  }

  return { returnType: null, nextCursor: cursor };
}

export function parseServiceContent(
  content: string,
  moduleSlug: string,
  options: { prefix?: string; queryMethodPrefixes?: string[] } = {}
): ParsedServiceModule | null {
  const extracted = extractServiceClassBody(content);
  if (!extracted) return null;

  const queryMethodPrefixes = options.queryMethodPrefixes?.length
    ? options.queryMethodPrefixes
    : ["get"];

  const { serviceClassName, body } = extracted;
  const methods: ParsedServiceMethod[] = [];
  let i = 0;

  while (i < body.length) {
    i = skipWhitespaceAndComments(body, i);
    if (i >= body.length) break;

    if (body[i] === ";") {
      i++;
      continue;
    }

    const headerMatch =
      /^(?:(public|private|protected|static|readonly|async|override)\s+)*([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(
        body.slice(i)
      );

    if (!headerMatch) {
      i++;
      continue;
    }

    const [fullHeader, , fnName] = headerMatch;
    const modifiers = fullHeader.slice(0, fullHeader.length - fnName.length);
    const isNonPublicOrStatic = /\b(?:private|protected|static)\b/.test(modifiers);

    let cursor = skipWhitespaceAndComments(body, i + fullHeader.length);

    // Optional method generic type parameters (e.g. foo<T>(...))
    if (body[cursor] === "<") {
      const genericEnd = findMatchingDelimiter(body, cursor, "<", ">");
      if (genericEnd !== -1) {
        cursor = skipWhitespaceAndComments(body, genericEnd + 1);
      }
    }

    // Class field/property rather than a method
    if (body[cursor] !== "(") {
      i = skipClassField(body, cursor);
      continue;
    }

    const paramsEnd = findMatchingDelimiter(body, cursor, "(", ")");
    if (paramsEnd === -1) break;

    const rawParams = body.slice(cursor + 1, paramsEnd).trim();
    cursor = skipWhitespaceAndComments(body, paramsEnd + 1);

    let returnType: string | null = null;
    if (body[cursor] === ":") {
      const parsedReturn = parsePromiseReturnType(body, cursor);
      returnType = parsedReturn.returnType;
      cursor = parsedReturn.nextCursor;
    }

    if (body[cursor] === "{") {
      const bodyEnd = findMatchingDelimiter(body, cursor, "{", "}");
      if (bodyEnd === -1) break;
      i = bodyEnd + 1;
    } else {
      i = cursor + 1;
    }

    if (fnName === "constructor" || isNonPublicOrStatic || returnType === null) {
      continue;
    }

    methods.push({
      fnName,
      pascalFnName: toPascalCase(fnName),
      params: parseMethodParams(rawParams),
      returnType,
      isQuery: isQueryMethod(fnName, queryMethodPrefixes),
    });
  }

  const { pascalTag, camelTag } = deriveTagFromServiceClass(
    serviceClassName,
    moduleSlug,
    options.prefix || ""
  );

  return {
    moduleSlug,
    serviceClassName,
    pascalTag,
    camelTag,
    methods,
  };
}

export function parseServiceFile(
  servicePath: string,
  moduleSlug: string,
  options: { prefix?: string; queryMethodPrefixes?: string[] } = {}
): ParsedServiceModule | null {
  if (!fs.existsSync(servicePath)) return null;
  return parseServiceContent(fs.readFileSync(servicePath, "utf8"), moduleSlug, options);
}

export function collectTypesFromText(text: string, acc: Set<string>): void {
  // Strip quoted string literals so string union members (e.g. `"Admin"`) are never treated as types
  const withoutStrings = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, " ");
  for (const match of withoutStrings.match(/\b[A-Z][a-zA-Z0-9_$]*\b/g) || []) {
    if (!BUILTIN_TYPE_NAMES.has(match)) {
      acc.add(match);
    }
  }
}

function extractExportedTypeNames(filePath: string): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(filePath)) return names;

  const content = fs.readFileSync(filePath, "utf8");
  const regex =
    /export\s+(?:declare\s+)?(?:const\s+)?(?:interface|type|enum|class)\s+([A-Z][a-zA-Z0-9_$]*)\b/g;

  for (const match of content.matchAll(regex)) {
    names.add(match[1]);
  }
  return names;
}

export function discoverAvailableTypeSymbols(inputDir: string): AvailableTypeSymbols {
  const typesCandidate = path.join(inputDir, "types.ts");
  const legacyInterfacesCandidate = path.join(inputDir, "interfaces.ts");
  const enumsCandidate = path.join(inputDir, "enums.ts");

  const typesFilePath = fs.existsSync(typesCandidate)
    ? typesCandidate
    : fs.existsSync(legacyInterfacesCandidate)
      ? legacyInterfacesCandidate
      : null;

  const enumsFilePath = fs.existsSync(enumsCandidate) ? enumsCandidate : null;

  return {
    typesFilePath,
    typesSymbols: typesFilePath ? extractExportedTypeNames(typesFilePath) : new Set(),
    enumsFilePath,
    enumsSymbols: enumsFilePath ? extractExportedTypeNames(enumsFilePath) : new Set(),
  };
}
