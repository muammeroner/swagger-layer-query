import * as fs from "node:fs";
import * as path from "node:path";

export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, (c: string) => c.toUpperCase());
}

export function toCamelCase(str: string): string {
  const p = toPascalCase(str);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function normalizeModuleName(value: string): string {
  return toKebabCase(value).replace(/[-_]/g, "").toLowerCase();
}

export function isModuleExcluded(name: string, excludedModules: string[]): boolean {
  if (!name || excludedModules.length === 0) return false;
  const target = normalizeModuleName(name);
  return excludedModules.some((ex) => normalizeModuleName(ex) === target);
}

export function getAvailableModules(inputDir: string, excludedModules: string[]): string[] {
  if (!fs.existsSync(inputDir)) return [];
  return fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter(
      (ent) =>
        ent.isDirectory() &&
        !isModuleExcluded(ent.name, excludedModules) &&
        fs.existsSync(path.join(inputDir, ent.name, "service.ts"))
    )
    .map((ent) => ent.name)
    .sort();
}

export function resolveModule(inputName: string, available: string[]): string | null {
  const trimmed = inputName.trim();
  if (!trimmed) return null;

  // 1. Exact match (e.g. "team", "model-group")
  if (available.includes(trimmed)) return trimmed;

  // 2. Kebab-case match (e.g. "modelGroup" -> "model-group", "ModelGroup" -> "model-group")
  const kebab = toKebabCase(trimmed);
  if (available.includes(kebab)) return kebab;

  // 3. Case-insensitive match (e.g. "Team" -> "team")
  const lower = trimmed.toLowerCase();
  const ciMatch = available.find((m) => m.toLowerCase() === lower);
  if (ciMatch) return ciMatch;

  // 4. Normalized match ignoring hyphens/underscores (e.g. "modelgroup" -> "model-group")
  const normalized = normalizeModuleName(trimmed);
  return available.find((m) => normalizeModuleName(m) === normalized) ?? null;
}

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function stripTsExtension(filePath: string): string {
  return filePath.replace(/\.(tsx?|mts|cts)$/i, "");
}

export function buildImportPath(
  fromDir: string,
  targetAbsolutePathNoExt: string,
  inputDirAbsolute: string,
  importAlias: string
): string {
  const trimmedAlias = importAlias.trim().replace(/\/+$/, "");
  if (trimmedAlias) {
    const relFromInput = toPosixPath(path.relative(inputDirAbsolute, targetAbsolutePathNoExt));
    return relFromInput ? `${trimmedAlias}/${relFromInput}` : trimmedAlias;
  }

  const rel = toPosixPath(path.relative(fromDir, targetAbsolutePathNoExt));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function deriveTagFromServiceClass(
  serviceClassName: string,
  moduleSlug: string,
  configuredPrefix: string
): { pascalTag: string; camelTag: string } {
  let withoutService = serviceClassName.replace(/Service$/, "");

  if (configuredPrefix && withoutService.startsWith(configuredPrefix)) {
    const stripped = withoutService.slice(configuredPrefix.length);
    if (stripped) {
      withoutService = stripped;
    }
  } else {
    const pascalSlug = toPascalCase(moduleSlug);
    if (withoutService.length > pascalSlug.length && withoutService.endsWith(pascalSlug)) {
      withoutService = pascalSlug;
    }
  }

  const pascalTag = toPascalCase(withoutService || moduleSlug);
  return {
    pascalTag,
    camelTag: toCamelCase(pascalTag),
  };
}
