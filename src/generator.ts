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
    return { log: () => { }, warn: () => { } };
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

function renderTypeImport(symbols: string[], importPath: string | null): string | null {
  if (symbols.length === 0 || !importPath) return null;
  return `import type { ${symbols.join(", ")} } from ${JSON.stringify(importPath)};`;
}

function hasOnlyOptionalParams(method: ParsedServiceMethod): boolean {
  return method.params.every((p) => p.optional);
}

/** `args: FooArgs` or `args?: FooArgs` when every param is optional */
function renderArgsParam(method: ParsedServiceMethod): string {
  const optionalMark = hasOnlyOptionalParams(method) ? "?" : "";
  return `args${optionalMark}: ${method.pascalFnName}Args`;
}

/** Spreads the args object back into positional service call arguments */
function renderCallArgs(method: ParsedServiceMethod, source: string): string {
  return method.params.map((p) => `${source}.${p.name}`).join(", ");
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
    const keyBase = `...${camelTag}QueryKeys.all, ${JSON.stringify(q.fnName)}`;
    return q.params.length === 0
      ? `  ${q.fnName}: () => [${keyBase}] as const,`
      : `  ${q.fnName}: (${renderArgsParam(q)}) => [${keyBase}, args] as const,`;
  });

  return [
    `export const ${camelTag}QueryKeys = {`,
    `  all: [${JSON.stringify(camelTag)}] as const,`,
    ...entries,
    `};`,
  ].join("\n");
}

function renderQueryHook(camelTag: string, q: ParsedServiceMethod): string {
  const hasParams = q.params.length > 0;
  const argsSource = hasOnlyOptionalParams(q) ? "args?" : "args";
  const signatureParams = [
    ...(hasParams ? [`  ${renderArgsParam(q)},`] : []),
    `  options?: Omit<UseQueryOptions<${q.returnType}, Error>, "queryKey" | "queryFn">`,
  ];

  return [
    `export function use${q.pascalFnName}Query(`,
    ...signatureParams,
    `) {`,
    `  return useQuery({`,
    `    queryKey: ${camelTag}QueryKeys.${q.fnName}(${hasParams ? "args" : ""}),`,
    `    queryFn: () => service.${q.fnName}(${hasParams ? renderCallArgs(q, argsSource) : ""}),`,
    `    ...options,`,
    `  });`,
    `}`,
  ].join("\n");
}

function renderMutationFn(m: ParsedServiceMethod): string[] {
  if (m.params.length === 0) {
    return [`    mutationFn: () => service.${m.fnName}(),`];
  }
  if (hasOnlyOptionalParams(m)) {
    return [
      `    mutationFn: (args: ${m.pascalFnName}Args | void) => {`,
      `      const resolved = args ? args : undefined;`,
      `      return service.${m.fnName}(${renderCallArgs(m, "resolved?")});`,
      `    },`,
    ];
  }
  return [
    `    mutationFn: (args: ${m.pascalFnName}Args) => service.${m.fnName}(${renderCallArgs(m, "args")}),`,
  ];
}

function renderMutationHook(m: ParsedServiceMethod): string {
  // When all params are optional the hook can be called with no variables at all
  const acceptsVoid = m.params.length > 0 && hasOnlyOptionalParams(m);
  const variablesType = `${m.pascalFnName}Args${acceptsVoid ? " | void" : ""}`;

  return [
    `export function use${m.pascalFnName}Mutation(`,
    `  options?: UseMutationOptions<${m.returnType}, Error, ${variablesType}>`,
    `) {`,
    `  return useMutation({`,
    ...renderMutationFn(m),
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

  const enumsImport = renderTypeImport(sortedEnums, enumsImportPath);
  const typesImport = renderTypeImport(sortedTypes, typesImportPath);
  if (enumsImport) headerLines.push(enumsImport);
  if (typesImport) headerLines.push(typesImport);

  const blocks = [
    ...(useClient ? [`"use client";`] : []),
    headerLines.join("\n"),
    `const service = new ${serviceClassName}();`,
    ...methods.map(renderArgsType),
    ...(queryMethods.length > 0 ? [renderQueryKeys(camelTag, queryMethods)] : []),
    ...queryMethods.map((q) => renderQueryHook(camelTag, q)),
    ...mutationMethods.map(renderMutationHook),
  ];

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

export interface ModuleGenerateContext {
  root: string;
  inputDir: string;
  outputDir: string;
  config: SwaggerLayerQueryConfig;
  availableSymbols?: AvailableTypeSymbols;
  silent?: boolean;
}

export function generateQueriesForModule(
  moduleSlug: string,
  context: ModuleGenerateContext
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
    serviceImportPath: toImport(servicePath),
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

  const hookCount = parsed.methods.length;
  const queryCount = parsed.methods.filter((m) => m.isQuery).length;
  const mutationCount = hookCount - queryCount;

  logger.log(
    `✓ Generated ${toPosixPath(path.relative(root, outputFilePath))} (${hookCount} hooks: ${queryCount} queries, ${mutationCount} mutations)`
  );

  return {
    moduleSlug,
    serviceClassName: parsed.serviceClassName,
    outputFilePath,
    hookCount,
    queryCount,
    mutationCount,
  };
}

function removeDirIfOnlyContains(dir: string, allowedEntries: string[]): void {
  if (!fs.existsSync(dir)) return;
  if (fs.readdirSync(dir).every((entry) => allowedEntries.includes(entry))) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

    // Drop the hooks subdir if only its barrel is left, then the feature dir if it is empty
    if (trimmedSubDir) {
      removeDirIfOnlyContains(targetDir, ["index.ts"]);
    }
    removeDirIfOnlyContains(featureDir, []);
  }

  return removed;
}

function formatModuleNotFound(targetName: string, inputDir: string, available: string[]): string {
  const availableList =
    available.length > 0
      ? available.map((m) => `  - ${m}`).join("\n")
      : "  (no modules with service.ts found)";
  return `Feature "${targetName}" was not found under "${inputDir}".\nAvailable features:\n${availableList}`;
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

  logger.log(`Swagger Layer Query - Generating React Query Hooks`);
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
      throw new Error(formatModuleNotFound(targetName, config.inputDir, available));
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

  logger.log(`Swagger Layer Query - Generation Complete`);

  return {
    config,
    inputDir,
    outputDir,
    modules,
    removedExcludedFiles,
  };
}
