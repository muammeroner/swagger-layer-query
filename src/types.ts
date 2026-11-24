export interface SwaggerLayerQueryConfig {
  /** Directory containing generated `<module>/service.ts`, `types.ts`, and `enums.ts` (e.g. "src/api" or "lib/data") */
  inputDir: string;
  /** Target features directory where hooks will be generated (e.g. "src/features" or "features") */
  outputDir: string;
  /** Subdirectory inside each feature folder (e.g. "hooks"). Set to "" to place directly inside `<outputDir>/<module>/`. */
  hooksSubDir: string;
  /** Output filename for the generated hooks file (default: "use-query.ts") */
  fileName: string;
  /**
   * Optional import alias prefix mapped to `inputDir` (e.g. "@/lib/data" or "@/api").
   * Leave empty ("") to automatically generate relative import paths.
   */
  importAlias: string;
  /**
   * Optional service class prefix to strip when deriving query key names (e.g. "App", "Rg").
   * When empty, the generator strips any prefix matching the module slug automatically.
   */
  prefix: string;
  /** Emit `"use client";` directive at the top of generated hook files (default: true) */
  useClient: boolean;
  /** Module slugs/names to exclude from hook generation */
  excludedModules: string[];
  /** Method name prefixes (case-insensitive) treated as `useQuery` hooks (default: ["get"]) */
  queryMethodPrefixes: string[];
  /** Create/update barrel `index.ts` files inside hooks and feature folders (default: true) */
  updateIndexFiles: boolean;
  /** Remove previously generated hook files belonging to excluded modules (default: true) */
  cleanExcluded: boolean;
}

export interface RawSwaggerLayerQueryConfig {
  inputDir?: string;
  dataDir?: string;
  servicesDir?: string;
  sourceDir?: string;
  outputDir?: string;
  featuresDir?: string;
  exportPath?: string;
  hooksSubDir?: string;
  fileName?: string;
  importAlias?: string;
  prefix?: string;
  servicePrefix?: string;
  useClient?: boolean;
  excludedModules?: string[];
  queryMethodPrefixes?: string[];
  updateIndexFiles?: boolean;
  cleanExcluded?: boolean;
}

export interface RawSwaggerLayerConfig {
  baseUrl?: string;
  exportPath?: string;
  output?: string;
  prefix?: string;
  servicePrefix?: string;
  version?: string;
  input?: string;
  httpClient?: string;
  excludedModules?: string[];
}

export interface RawConfigFile extends RawSwaggerLayerConfig {
  swaggerLayer?: RawSwaggerLayerConfig;
  swaggerLayerQuery?: RawSwaggerLayerQueryConfig;
}

export interface CliArgs {
  init?: boolean;
  help?: boolean;
  versionFlag?: boolean;
  /** Target a single feature/module by name */
  name?: string;
  config?: string;
  inputDir?: string;
  outputDir?: string;
  hooksSubDir?: string;
  fileName?: string;
  importAlias?: string;
  prefix?: string;
  exclude?: string;
  queryPrefixes?: string;
  useClient?: boolean;
  updateIndexFiles?: boolean;
  cleanExcluded?: boolean;
}

export interface GenerateHooksOptions {
  cwd?: string;
  args?: CliArgs;
  config?: Partial<SwaggerLayerQueryConfig>;
  /** Target a single module/feature name programmatically */
  name?: string;
  /** Suppress console output (useful for programmatic usage/tests) */
  silent?: boolean;
}

export interface ParsedMethodParam {
  name: string;
  optional: boolean;
  type: string;
}

export interface ParsedServiceMethod {
  fnName: string;
  pascalFnName: string;
  params: ParsedMethodParam[];
  returnType: string;
  isQuery: boolean;
}

export interface ParsedServiceModule {
  moduleSlug: string;
  serviceClassName: string;
  pascalTag: string;
  camelTag: string;
  methods: ParsedServiceMethod[];
}

export interface ModuleGenerateResult {
  moduleSlug: string;
  serviceClassName: string;
  outputFilePath: string;
  hookCount: number;
  queryCount: number;
  mutationCount: number;
}

export interface GenerateHooksResult {
  config: SwaggerLayerQueryConfig;
  inputDir: string;
  outputDir: string;
  modules: ModuleGenerateResult[];
  removedExcludedFiles: string[];
}
