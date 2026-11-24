import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs, readConfig, resolveConfigFilePath } from "./config.js";
import {
  collectTypesFromText,
  discoverAvailableTypeSymbols,
  parseServiceFile,
  type AvailableTypeSymbols,
} from "./parser.js";
import type {
  GenerateHooksOptions,
  GenerateHooksResult,
  ModuleGenerateResult,
  ParsedServiceMethod,
  ParsedServiceModule,
  SwaggerLayerQueryConfig,
} from "./types.js";
import {
  buildImportPath,
  getAvailableModules,
  isModuleExcluded,
  resolveModule,
  stripTsExtension,
  toKebabCase,
  toPosixPath,
} from "./utils.js";

export interface GenerateHooksCodeParams {
  parsed: ParsedServiceModule;
  serviceImportPath: string;
  typesImportPath: string | null;
  enumsImportPath: string | null;
  sourceLabel: string;
  availableSymbols: AvailableTypeSymbols;
  useClient: boolean;
}

interface Logger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

function createLogger(silent?: boolean): Logger {
  if (silent) {
    return { log: () => {}, warn: () => {} };
  }
  return {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
  };
}

function resolveTargetDir(
  outputDir: string,
  moduleSlug: string,
  hooksSubDir: string
): { featureDir: string; targetDir: string; trimmedSubDir: string } {
  const featureDir = path.join(outputDir, moduleSlug);
  const trimmedSubDir = hooksSubDir.trim().replace(/^\/+|\/+$/g, "");
  const targetDir = trimmedSubDir ? path.join(featureDir, trimmedSubDir) : featureDir;
  return { featureDir, targetDir, trimmedSubDir };
}

function resolveReferencedImports(
  methods: ParsedServiceMethod[],
  availableSymbols: AvailableTypeSymbols,
  typesImportPath: string | null
): { sortedEnums: string[]; sortedTypes: string[] } {
  const referenced = new Set<string>();
  for (const m of methods) {
    collectTypesFromText(m.returnType, referenced);
    for (const p of m.params) {
      collectTypesFromText(p.type, referenced);
    }
  }

  const sortedEnums: string[] = [];
  const sortedTypes: string[] = [];

  for (const sym of Array.from(referenced).sort()) {
    if (availableSymbols.enumsSymbols.has(sym)) {
      sortedEnums.push(sym);
    } else if (
      availableSymbols.typesSymbols.size > 0
        ? availableSymbols.typesSymbols.has(sym)
        : typesImportPath !== null
    ) {
      sortedTypes.push(sym);
    }
  }

  return { sortedEnums, sortedTypes };
}

function renderReactQueryImport(hasQueries: boolean, hasMutations: boolean): string {
  if (hasQueries && hasMutations) {
    return `import { useMutation, useQuery, type UseMutationOptions, type UseQueryOptions } from "@tanstack/react-query";`;
  }
  if (hasQueries) {
    return `import { useQuery, type UseQueryOptions } from "@tanstack/react-query";`;
  }
  return `import { useMutation, type UseMutationOptions } from "@tanstack/react-query";`;
}

function renderArgsType(method: ParsedServiceMethod): string {
  if (method.params.length === 0) {
    return `export type ${method.pascalFnName}Args = void;`;
  }
  const fields = method.params.map((p) => `  ${p.name}${p.optional ? "?" : ""}: ${p.type};`);
  return [`export type ${method.pascalFnName}Args = {`, ...fields, `};`].join("\n");
}

function renderQueryKeys(camelTag: string, queryMethods: ParsedServiceMethod[]): string {
  const entries = queryMethods.map((q) => {
    if (q.params.length === 0) {
      return `  ${q.fnName}: () => [...${camelTag}QueryKeys.all, ${JSON.stringify(q.fnName)}] as const,`;
    }
    const allOptional = q.params.every((p) => p.optional);
    const argsParam = allOptional ? `args?: ${q.pascalFnName}Args` : `args: ${q.pascalFnName}Args`;
    return `  ${q.fnName}: (${argsParam}) => [...${camelTag}QueryKeys.all, ${JSON.stringify(q.fnName)}, args] as const,`;
  });

  return [
    `export const ${camelTag}QueryKeys = {`,
    `  all: [${JSON.stringify(camelTag)}] as const,`,
    ...entries,
    `};`,
  ].join("\n");
}

function renderQueryHook(camelTag: string, q: ParsedServiceMethod): string {
  const optionsParam = `options?: Omit<UseQueryOptions<${q.returnType}, Error>, "queryKey" | "queryFn">`;

  if (q.params.length === 0) {
    return [
      `export function use${q.pascalFnName}Query(`,
      `  ${optionsParam}`,
      `) {`,
      `  return useQuery({`,
      `    queryKey: ${camelTag}QueryKeys.${q.fnName}(),`,
      `    queryFn: () => service.${q.fnName}(),`,
      `    ...options,`,
      `  });`,
      `}`,
    ].join("\n");
  }

  const allOptional = q.params.every((p) => p.optional);
  const argsParam = allOptional ? `args?: ${q.pascalFnName}Args` : `args: ${q.pascalFnName}Args`;
  const callArgs = q.params
    .map((p) => (allOptional ? `args?.${p.name}` : `args.${p.name}`))
    .join(", ");

  return [
    `export function use${q.pascalFnName}Query(`,
    `  ${argsParam},`,
    `  ${optionsParam}`,
    `) {`,
    `  return useQuery({`,
    `    queryKey: ${camelTag}QueryKeys.${q.fnName}(args),`,
    `    queryFn: () => service.${q.fnName}(${callArgs}),`,
    `    ...options,`,
    `  });`,
    `}`,
  ].join("\n");
}

function renderMutationHook(m: ParsedServiceMethod): string {
  if (m.params.length === 0) {
    return [
      `export function use${m.pascalFnName}Mutation(`,
      `  options?: UseMutationOptions<${m.returnType}, Error, ${m.pascalFnName}Args>`,
      `) {`,
      `  return useMutation({`,
      `    mutationFn: () => service.${m.fnName}(),`,
      `    ...options,`,
      `  });`,
      `}`,
    ].join("\n");
  }

  const allOptional = m.params.every((p) => p.optional);
  if (allOptional) {
    const callArgs = m.params.map((p) => `resolved?.${p.name}`).join(", ");
    return [
      `export function use${m.pascalFnName}Mutation(`,
      `  options?: UseMutationOptions<${m.returnType}, Error, ${m.pascalFnName}Args | void>`,
      `) {`,
      `  return useMutation({`,
      `    mutationFn: (args: ${m.pascalFnName}Args | void) => {`,
      `      const resolved = args ? args : undefined;`,
      `      return service.${m.fnName}(${callArgs});`,
      `    },`,
      `    ...options,`,
      `  });`,
      `}`,
    ].join("\n");
  }

  const callArgs = m.params.map((p) => `args.${p.name}`).join(", ");
  return [
    `export function use${m.pascalFnName}Mutation(`,
    `  options?: UseMutationOptions<${m.returnType}, Error, ${m.pascalFnName}Args>`,
    `) {`,
    `  return useMutation({`,
    `    mutationFn: (args: ${m.pascalFnName}Args) => service.${m.fnName}(${callArgs}),`,
    `    ...options,`,
    `  });`,
    `}`,
  ].join("\n");
}

export function generateHooksCode(params: GenerateHooksCodeParams): string {
  const {
    parsed,
    serviceImportPath,
    typesImportPath,
    enumsImportPath,
    sourceLabel,
    availableSymbols,
    useClient,
  } = params;

  const { serviceClassName, camelTag, methods } = parsed;
  const queryMethods = methods.filter((m) => m.isQuery);
  const mutationMethods = methods.filter((m) => !m.isQuery);
  const { sortedEnums, sortedTypes } = resolveReferencedImports(
    methods,
    availableSymbols,
    typesImportPath
  );

  const headerLines = [
    `// Auto-generated by swagger-layer-query from ${sourceLabel}`,
    `// Requires @tanstack/react-query to be installed in the app.`,
    renderReactQueryImport(queryMethods.length > 0, mutationMethods.length > 0),
    `import { ${serviceClassName} } from ${JSON.stringify(serviceImportPath)};`,
  ];

  if (sortedEnums.length > 0 && enumsImportPath) {
    headerLines.push(
      `import type { ${sortedEnums.join(", ")} } from ${JSON.stringify(enumsImportPath)};`
    );
  }
  if (sortedTypes.length > 0 && typesImportPath) {
    headerLines.push(
      `import type { ${sortedTypes.join(", ")} } from ${JSON.stringify(typesImportPath)};`
    );
  }

  const blocks: string[] = [];
  if (useClient) {
    blocks.push(`"use client";`);
  }

  blocks.push(headerLines.join("\n"));
  blocks.push(`const service = new ${serviceClassName}();`);

  for (const method of methods) {
    blocks.push(renderArgsType(method));
  }

  if (queryMethods.length > 0) {
    blocks.push(renderQueryKeys(camelTag, queryMethods));
  }

  for (const query of queryMethods) {
    blocks.push(renderQueryHook(camelTag, query));
  }

  for (const mutation of mutationMethods) {
    blocks.push(renderMutationHook(mutation));
  }

  return blocks.join("\n\n") + "\n";
}

function ensureBarrelExport(
  indexPath: string,
  specifier: string,
  createIfMissing: boolean
): void {
  const exportLine = `export * from ${JSON.stringify(specifier)};\n`;

  if (!fs.existsSync(indexPath)) {
    if (createIfMissing) {
      fs.writeFileSync(indexPath, exportLine, "utf8");
    }
    return;
  }

  const existing = fs.readFileSync(indexPath, "utf8");
  const hasExport = existing.includes(`"${specifier}"`) || existing.includes(`'${specifier}'`);
  if (!hasExport) {
    fs.writeFileSync(indexPath, exportLine + existing, "utf8");
  }
}

function updateBarrelExports(
  targetDir: string,
  featureDir: string,
  trimmedSubDir: string,
  fileName: string
): void {
  ensureBarrelExport(
    path.join(targetDir, "index.ts"),
    `./${stripTsExtension(fileName)}`,
    true
  );

  if (trimmedSubDir) {
    ensureBarrelExport(
      path.join(featureDir, "index.ts"),
      `./${toPosixPath(trimmedSubDir)}`,
      false
    );
  }
}

export function generateQueriesForModule(
  moduleSlug: string,
  context: {
    root: string;
    inputDir: string;
    outputDir: string;
    config: SwaggerLayerQueryConfig;
    availableSymbols?: AvailableTypeSymbols;
    silent?: boolean;
  }
): ModuleGenerateResult | null {
  const { root, inputDir, outputDir, config, silent } = context;
  const logger = createLogger(silent);

  const servicePath = path.join(inputDir, moduleSlug, "service.ts");
  if (!fs.existsSync(servicePath)) {
    logger.warn(`[swagger-layer-query] Service not found at: ${servicePath}`);
    return null;
  }

  const parsed = parseServiceFile(servicePath, moduleSlug, {
    prefix: config.prefix,
    queryMethodPrefixes: config.queryMethodPrefixes,
  });

  if (!parsed) {
    logger.warn(`[swagger-layer-query] No service class found in ${servicePath}`);
    return null;
  }

  if (parsed.methods.length === 0) {
    logger.log(`[swagger-layer-query] No methods found in ${parsed.serviceClassName}`);
    return null;
  }

  const availableSymbols = context.availableSymbols ?? discoverAvailableTypeSymbols(inputDir);
  const { featureDir, targetDir, trimmedSubDir } = resolveTargetDir(
    outputDir,
    moduleSlug,
    config.hooksSubDir
  );

  const toImport = (targetAbsolute: string): string =>
    buildImportPath(targetDir, stripTsExtension(targetAbsolute), inputDir, config.importAlias);

  const code = generateHooksCode({
    parsed,
    serviceImportPath: toImport(path.join(inputDir, moduleSlug, "service.ts")),
    typesImportPath: availableSymbols.typesFilePath ? toImport(availableSymbols.typesFilePath) : null,
    enumsImportPath: availableSymbols.enumsFilePath ? toImport(availableSymbols.enumsFilePath) : null,
    sourceLabel: toPosixPath(path.relative(root, servicePath)),
    availableSymbols,
    useClient: config.useClient,
  });

  fs.mkdirSync(targetDir, { recursive: true });
  const outputFilePath = path.join(targetDir, config.fileName);
  fs.writeFileSync(outputFilePath, code, "utf8");

  if (config.updateIndexFiles) {
    updateBarrelExports(targetDir, featureDir, trimmedSubDir, config.fileName);
  }

  const queryCount = parsed.methods.filter((m) => m.isQuery).length;
  const mutationCount = parsed.methods.length - queryCount;

  logger.log(
    `✓ Generated ${toPosixPath(path.relative(root, outputFilePath))} (${parsed.methods.length} hooks: ${queryCount} queries, ${mutationCount} mutations)`
  );

  return {
    moduleSlug,
    serviceClassName: parsed.serviceClassName,
    outputFilePath,
    hookCount: parsed.methods.length,
    queryCount,
    mutationCount,
  };
}

function cleanupExcludedHooks(
  root: string,
  outputDir: string,
  config: SwaggerLayerQueryConfig,
  logger: Logger
): string[] {
  if (!config.cleanExcluded || config.excludedModules.length === 0) {
    return [];
  }

  const removed: string[] = [];
  for (const excluded of config.excludedModules) {
    const exSlug = toKebabCase(excluded);
    const { featureDir, targetDir, trimmedSubDir } = resolveTargetDir(
      outputDir,
      exSlug,
      config.hooksSubDir
    );
    const hooksFile = path.join(targetDir, config.fileName);

    if (!fs.existsSync(hooksFile)) continue;

    fs.rmSync(hooksFile, { force: true });
    removed.push(hooksFile);
    logger.log(
      `✓ Removed query hooks for excluded feature: ${toPosixPath(path.relative(root, hooksFile))}`
    );

    if (trimmedSubDir && fs.existsSync(targetDir)) {
      const remaining = fs.readdirSync(targetDir);
      if (remaining.length === 0 || (remaining.length === 1 && remaining[0] === "index.ts")) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }
    if (fs.existsSync(featureDir) && fs.readdirSync(featureDir).length === 0) {
      fs.rmSync(featureDir, { recursive: true, force: true });
    }
  }

  return removed;
}

export async function generateQueries(
  options: GenerateHooksOptions = {}
): Promise<GenerateHooksResult> {
  const root = path.resolve(
    options.cwd || process.env.SWAGGER_LAYER_QUERY_PROJECT_ROOT || process.cwd()
  );
  const args = options.args ?? (options.config || options.name || options.cwd ? {} : parseArgs());
  const configPath = resolveConfigFilePath(root, args.config);
  const config = readConfig(root, args, options.config);
  const silent = Boolean(options.silent);
  const logger = createLogger(silent);
  const targetName = (options.name ?? args.name ?? "").trim();

  const inputDir = path.resolve(root, config.inputDir);
  const outputDir = path.resolve(root, config.outputDir);

  logger.log(`=== [swagger-layer-query] Generating React Query Hooks ===`);
  logger.log(`Config File  : ${configPath || "(default)"}`);
  logger.log(`Input Dir    : ${config.inputDir}`);
  logger.log(`Output Dir   : ${config.outputDir}`);
  logger.log(`Import Alias : ${config.importAlias || "(relative)"}`);

  const removedExcludedFiles = cleanupExcludedHooks(root, outputDir, config, logger);
  const available = getAvailableModules(inputDir, config.excludedModules);
  const availableSymbols = discoverAvailableTypeSymbols(inputDir);
  const moduleContext = { root, inputDir, outputDir, config, availableSymbols, silent };
  const modules: ModuleGenerateResult[] = [];

  if (targetName) {
    if (isModuleExcluded(targetName, config.excludedModules)) {
      throw new Error(
        `Feature "${targetName}" is listed in excludedModules and cannot be generated.`
      );
    }

    const resolved = resolveModule(targetName, available);
    if (!resolved) {
      const availableList =
        available.length > 0
          ? available.map((m) => `  - ${m}`).join("\n")
          : "  (no modules with service.ts found)";
      throw new Error(
        `Feature "${targetName}" was not found under "${config.inputDir}".\nAvailable features:\n${availableList}`
      );
    }

    logger.log(
      `Target Feature: "${resolved}"${resolved !== targetName ? ` (matched from "${targetName}")` : ""}`
    );

    const res = generateQueriesForModule(resolved, moduleContext);
    if (!res) {
      throw new Error(`Could not generate hooks for feature "${resolved}".`);
    }
    modules.push(res);
  } else {
    logger.log(`Scanning modules (${available.length} found)...`);
    for (const mod of available) {
      const res = generateQueriesForModule(mod, moduleContext);
      if (res) {
        modules.push(res);
      }
    }
    logger.log(`Generated React Query hooks for ${modules.length} feature(s).`);
  }

  logger.log(`=== [swagger-layer-query] Query Generation Complete ===\n`);

  return {
    config,
    inputDir,
    outputDir,
    modules,
    removedExcludedFiles,
  };
}
