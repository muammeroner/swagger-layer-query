import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CliArgs,
  RawConfigFile,
  RawSwaggerLayerConfig,
  RawSwaggerLayerQueryConfig,
  SwaggerLayerQueryConfig,
} from "./types.js";

export const DEFAULT_CONFIG: Readonly<SwaggerLayerQueryConfig> = Object.freeze({
  inputDir: "src/api",
  outputDir: "src/features",
  hooksSubDir: "hooks",
  fileName: "use-query.ts",
  importAlias: "",
  prefix: "",
  useClient: true,
  excludedModules: [],
  queryMethodPrefixes: ["get"],
  updateIndexFiles: true,
  cleanExcluded: true,
});

export const DEFAULT_PACKAGE_SCRIPTS: Readonly<Record<string, string>> = Object.freeze({
  "generate:layer": "swagger-layer",
  "generate:query": "swagger-layer-query",
  "generate:sync": "npm run generate:layer && npm run generate:query",
});

const CONFIG_FILENAMES = ["config.json"] as const;

type StringCliKey =
  | "name"
  | "config"
  | "inputDir"
  | "outputDir"
  | "hooksSubDir"
  | "fileName"
  | "importAlias"
  | "prefix"
  | "exclude"
  | "queryPrefixes";

const VALUE_FLAG_MAP: Readonly<Record<string, StringCliKey>> = {
  name: "name",
  n: "name",
  feature: "name",
  f: "name",
  config: "config",
  c: "config",
  input: "inputDir",
  "input-dir": "inputDir",
  inputDir: "inputDir",
  "data-dir": "inputDir",
  dataDir: "inputDir",
  i: "inputDir",
  output: "outputDir",
  "output-dir": "outputDir",
  outputDir: "outputDir",
  "features-dir": "outputDir",
  featuresDir: "outputDir",
  o: "outputDir",
  "hooks-dir": "hooksSubDir",
  hooksSubDir: "hooksSubDir",
  "file-name": "fileName",
  fileName: "fileName",
  "import-alias": "importAlias",
  importAlias: "importAlias",
  prefix: "prefix",
  p: "prefix",
  exclude: "exclude",
  e: "exclude",
  "query-prefixes": "queryPrefixes",
  queryPrefixes: "queryPrefixes",
};

const ALLOW_EMPTY_CLI_KEYS = new Set<StringCliKey>(["hooksSubDir", "importAlias", "prefix"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function parseCommaList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJsonObject<T extends Record<string, unknown>>(filePath: string): T {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isPlainObject(parsed)) {
    throw new Error(`Configuration in ${filePath} must be a JSON object`);
  }
  return parsed as T;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    switch (token) {
      case "init":
        result.init = true;
        continue;
      case "--help":
      case "-h":
        result.help = true;
        continue;
      case "--version":
      case "-v":
        result.versionFlag = true;
        continue;
      case "--use-client":
        result.useClient = true;
        continue;
      case "--no-use-client":
        result.useClient = false;
        continue;
      case "--no-index":
        result.updateIndexFiles = false;
        continue;
      case "--no-clean-excluded":
        result.cleanExcluded = false;
        continue;
    }

    if (token.startsWith("-")) {
      const eqIdx = token.indexOf("=");
      const rawKey = (eqIdx === -1 ? token : token.slice(0, eqIdx)).replace(/^-+/, "");
      const targetKey = VALUE_FLAG_MAP[rawKey];

      if (!targetKey) {
        throw new Error(`Unknown argument: --${rawKey}`);
      }

      const value = eqIdx === -1 ? argv[++i] : token.slice(eqIdx + 1);
      const allowsEmpty = ALLOW_EMPTY_CLI_KEYS.has(targetKey);

      if (
        value === undefined ||
        (!allowsEmpty && !value) ||
        (eqIdx === -1 && value.startsWith("-"))
      ) {
        throw new Error(`Missing value for ${token}`);
      }

      result[targetKey] = targetKey === "name" ? value.trim() : value;
      continue;
    }

    if (!result.name) {
      result.name = token.trim();
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return result;
}

export function resolveConfigFilePaths(root: string, explicitConfig?: string): string[] {
  if (explicitConfig) {
    const resolved = path.resolve(root, explicitConfig);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return [resolved];
  }

  return CONFIG_FILENAMES.map((name) => path.resolve(root, name))
    .filter((fullPath) => fs.existsSync(fullPath))
    .map((fullPath) => ({ fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((entry) => entry.fullPath);
}

export function resolveConfigFilePath(root: string, explicitConfig?: string): string | undefined {
  const paths = resolveConfigFilePaths(root, explicitConfig);
  return paths[paths.length - 1];
}

function validateConfig(config: SwaggerLayerQueryConfig): void {
  if (typeof config.inputDir !== "string" || !config.inputDir.trim()) {
    throw new Error("inputDir must be a non-empty string");
  }
  if (typeof config.outputDir !== "string" || !config.outputDir.trim()) {
    throw new Error("outputDir must be a non-empty string");
  }
  if (typeof config.hooksSubDir !== "string") {
    throw new Error("hooksSubDir must be a string");
  }
  if (typeof config.fileName !== "string" || !config.fileName.trim()) {
    throw new Error("fileName must be a non-empty string");
  }
  if (typeof config.importAlias !== "string") {
    throw new Error("importAlias must be a string");
  }
  if (typeof config.prefix !== "string") {
    throw new Error("prefix must be a string");
  }
  if (
    !Array.isArray(config.excludedModules) ||
    !config.excludedModules.every((x) => typeof x === "string")
  ) {
    throw new Error("excludedModules must be an array of strings");
  }
  if (
    !Array.isArray(config.queryMethodPrefixes) ||
    config.queryMethodPrefixes.length === 0 ||
    !config.queryMethodPrefixes.every((x) => typeof x === "string" && x.trim().length > 0)
  ) {
    throw new Error("queryMethodPrefixes must be a non-empty array of strings");
  }
}

export function readConfig(
  root: string,
  args: CliArgs = {},
  overrides: Partial<SwaggerLayerQueryConfig> = {}
): SwaggerLayerQueryConfig {
  const configPaths = resolveConfigFilePaths(root, args.config);
  let rootConfig: RawSwaggerLayerConfig = {};
  let queryConfig: RawSwaggerLayerQueryConfig = {};

  for (const configPath of configPaths) {
    const parsed = readJsonObject<Record<string, unknown>>(configPath) as RawConfigFile &
      RawSwaggerLayerQueryConfig;
    rootConfig = {
      ...rootConfig,
      ...parsed,
      ...(isPlainObject(parsed.swaggerLayer) ? (parsed.swaggerLayer as RawSwaggerLayerConfig) : {}),
    };

    if (parsed.swaggerLayerQuery !== undefined) {
      if (!isPlainObject(parsed.swaggerLayerQuery)) {
        throw new Error(`"swaggerLayerQuery" configuration in ${configPath} must be a JSON object`);
      }
      queryConfig = {
        ...queryConfig,
        ...(parsed.swaggerLayerQuery as RawSwaggerLayerQueryConfig),
      };
    } else if (args.config) {
      // Allow flat query config when an explicit custom --config file is provided
      queryConfig = { ...queryConfig, ...parsed };
    }
  }

  const resolved: SwaggerLayerQueryConfig = {
    inputDir:
      args.inputDir ??
      overrides.inputDir ??
      queryConfig.inputDir ??
      queryConfig.dataDir ??
      queryConfig.servicesDir ??
      queryConfig.sourceDir ??
      rootConfig.exportPath ??
      rootConfig.output ??
      DEFAULT_CONFIG.inputDir,

    outputDir:
      args.outputDir ??
      overrides.outputDir ??
      queryConfig.outputDir ??
      queryConfig.featuresDir ??
      queryConfig.exportPath ??
      DEFAULT_CONFIG.outputDir,

    hooksSubDir:
      args.hooksSubDir ??
      overrides.hooksSubDir ??
      queryConfig.hooksSubDir ??
      DEFAULT_CONFIG.hooksSubDir,

    fileName:
      args.fileName ??
      overrides.fileName ??
      queryConfig.fileName ??
      DEFAULT_CONFIG.fileName,

    importAlias:
      args.importAlias ??
      overrides.importAlias ??
      queryConfig.importAlias ??
      DEFAULT_CONFIG.importAlias,

    prefix:
      args.prefix ??
      overrides.prefix ??
      queryConfig.prefix ??
      queryConfig.servicePrefix ??
      rootConfig.prefix ??
      rootConfig.servicePrefix ??
      DEFAULT_CONFIG.prefix,

    useClient:
      args.useClient ??
      overrides.useClient ??
      queryConfig.useClient ??
      DEFAULT_CONFIG.useClient,

    updateIndexFiles:
      args.updateIndexFiles ??
      overrides.updateIndexFiles ??
      queryConfig.updateIndexFiles ??
      DEFAULT_CONFIG.updateIndexFiles,

    cleanExcluded:
      args.cleanExcluded ??
      overrides.cleanExcluded ??
      queryConfig.cleanExcluded ??
      DEFAULT_CONFIG.cleanExcluded,

    excludedModules:
      parseCommaList(args.exclude) ??
      overrides.excludedModules ??
      queryConfig.excludedModules ??
      rootConfig.excludedModules ??
      [...DEFAULT_CONFIG.excludedModules],

    queryMethodPrefixes:
      parseCommaList(args.queryPrefixes) ??
      overrides.queryMethodPrefixes ??
      queryConfig.queryMethodPrefixes ??
      [...DEFAULT_CONFIG.queryMethodPrefixes],
  };

  validateConfig(resolved);
  return resolved;
}

export function ensureDefaultPackageScripts(root: string): {
  packageJsonPath: string;
  addedScripts: string[];
} | null {
  const packageJsonPath = path.resolve(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (!isPlainObject(parsed)) {
    return null;
  }

  const existingScripts: Record<string, string> = isPlainObject(parsed.scripts)
    ? { ...(parsed.scripts as Record<string, string>) }
    : {};

  const addedScripts: string[] = [];
  for (const [key, value] of Object.entries(DEFAULT_PACKAGE_SCRIPTS)) {
    if (!(key in existingScripts)) {
      existingScripts[key] = value;
      addedScripts.push(key);
    }
  }

  if (addedScripts.length > 0) {
    parsed.scripts = existingScripts;
    fs.writeFileSync(packageJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  }

  return { packageJsonPath, addedScripts };
}
