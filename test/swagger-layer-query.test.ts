import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { generateQueries, parseServiceContent } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const cli = path.join(pkgRoot, "dist", "bin", "swagger-layer-query.js");
const tscBin = path.join(pkgRoot, "node_modules", ".bin", "tsc");
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")
) as { version: string };

function writeReactQueryStub(cwd: string): void {
  const stubDir = path.join(cwd, "node_modules", "@tanstack", "react-query");
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(
    path.join(stubDir, "package.json"),
    JSON.stringify({ name: "@tanstack/react-query", version: "5.0.0", types: "index.d.ts" })
  );
  fs.writeFileSync(
    path.join(stubDir, "index.d.ts"),
    `export interface UseQueryOptions<TQueryFnData = unknown, TError = Error, TData = TQueryFnData> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<TQueryFnData>;
  enabled?: boolean;
  select?: (data: TQueryFnData) => TData;
}
export interface UseQueryResult<TData = unknown, TError = Error> {
  data: TData | undefined;
  error: TError | null;
  isLoading: boolean;
}
export declare function useQuery<TQueryFnData = unknown, TError = Error, TData = TQueryFnData>(
  options: UseQueryOptions<TQueryFnData, TError, TData>
): UseQueryResult<TData, TError>;

export interface UseMutationOptions<TData = unknown, TError = Error, TVariables = void, TContext = unknown> {
  mutationFn?: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => unknown;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => unknown;
}
export interface UseMutationResult<TData = unknown, TError = Error, TVariables = void> {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  data: TData | undefined;
  error: TError | null;
}
export declare function useMutation<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>
): UseMutationResult<TData, TError, TVariables>;
`
  );
}

function createSampleApiFixture(root: string, apiRelDir: string, prefix = "Acme"): void {
  const apiDir = path.join(root, apiRelDir);
  fs.mkdirSync(path.join(apiDir, "user"), { recursive: true });
  fs.mkdirSync(path.join(apiDir, "model-group"), { recursive: true });
  fs.mkdirSync(path.join(apiDir, "sem-ver"), { recursive: true });

  fs.writeFileSync(
    path.join(apiDir, "enums.ts"),
    `export enum EUserRole {
  Admin = 1,
  Member,
  Guest,
}
`
  );

  fs.writeFileSync(
    path.join(apiDir, "types.ts"),
    `import type { EUserRole } from "./enums";

export interface UserDto {
  id: string;
  email: string;
  role: EUserRole;
}

export interface CreateUserRequest {
  email: string;
  role: EUserRole;
}

export type PagedResult<T> = {
  items: T[];
  total: number;
};

export interface ModelGroupDto {
  id: string;
  name: string;
}
`
  );

  fs.writeFileSync(
    path.join(apiDir, "user", "service.ts"),
    `import type { EUserRole } from "../enums";
import type { CreateUserRequest, PagedResult, UserDto } from "../types";

export class ${prefix}UserService {
  constructor(private readonly repository: unknown = {}) {}

  getAllUsers(): Promise<UserDto[]> {
    return Promise.resolve([]);
  }

  getUsers(query?: { page?: number; role?: "Admin" | "Member" | "Guest"; enumRole?: EUserRole }): Promise<PagedResult<UserDto>> {
    return Promise.resolve({ items: [], total: 0 });
  }

  getUserById(id: string): Promise<UserDto> {
    return Promise.resolve({ id, email: "", role: 1 as EUserRole });
  }

  createUser(body: CreateUserRequest): Promise<UserDto> {
    return Promise.resolve({ id: "1", email: body.email, role: body.role });
  }

  syncUsers(query?: { force?: boolean }): Promise<void> {
    return Promise.resolve();
  }

  deleteUser(id: string): Promise<void> {
    return Promise.resolve();
  }

  resetCache(): Promise<void> {
    return Promise.resolve();
  }
}
`
  );

  fs.writeFileSync(
    path.join(apiDir, "model-group", "service.ts"),
    `import type { ModelGroupDto } from "../types";

export class ${prefix}ModelGroupService {
  constructor(private readonly repository: unknown = {}) {}

  async getModelGroups(): Promise<ModelGroupDto[]> {
    return [];
  }

  private internalHelper(): Promise<void> {
    return Promise.resolve();
  }
}
`
  );

  fs.writeFileSync(
    path.join(apiDir, "sem-ver", "service.ts"),
    `export class ${prefix}SemVerService {
  getVersion(): Promise<string> {
    return Promise.resolve("1.0.0");
  }
}
`
  );
}

test("CLI --help and --version", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /swagger-layer-query/);
  assert.match(help, /config\.json/);
  assert.match(help, /--input-dir/);
  assert.match(help, /--output-dir/);
  assert.match(help, /--import-alias/);
  const version = execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  }).trim();
  assert.equal(version, pkgJson.version);
});

test("CLI init adds default package.json scripts without creating separate config files or overwriting existing scripts", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-query-init-"));
  try {
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "demo-app",
        scripts: {
          dev: "next dev",
          "generate:layer": "swagger-layer --prefix Custom",
        },
      })
    );

    execFileSync(process.execPath, [cli, "init"], { cwd, encoding: "utf8" });
    assert.ok(!fs.existsSync(path.join(cwd, "swagger-layer-query.config.json")));
    assert.ok(!fs.existsSync(path.join(cwd, "config.json")));

    const updatedPkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    assert.equal(updatedPkg.scripts.dev, "next dev");
    // Preserves already-defined script
    assert.equal(updatedPkg.scripts["generate:layer"], "swagger-layer --prefix Custom");
    // Adds missing default scripts
    assert.equal(updatedPkg.scripts["generate:query"], "swagger-layer-query");
    assert.equal(
      updatedPkg.scripts["generate:sync"],
      "npm run generate:layer && npm run generate:query"
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("generates strictly type-safe React Query hooks with relative imports, enums, nested generics, and barrel exports", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-query-rel-"));
  try {
    createSampleApiFixture(cwd, "src/api", "Acme");
    writeReactQueryStub(cwd);

    // Pre-create feature index.ts to verify it gets updated without clobbering existing exports
    fs.mkdirSync(path.join(cwd, "src", "features", "user"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "src", "features", "user", "index.ts"),
      `export const existingFeatureExport = true;\n`
    );

    // Pre-create stale excluded hook file to verify cleanup
    fs.mkdirSync(path.join(cwd, "src", "features", "sem-ver", "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "src", "features", "sem-ver", "hooks", "use-query.ts"),
      `// stale`
    );
    fs.writeFileSync(
      path.join(cwd, "src", "features", "sem-ver", "hooks", "index.ts"),
      `export * from "./use-query";\n`
    );

    // Sibling config.json should be auto-inherited!
    fs.writeFileSync(
      path.join(cwd, "config.json"),
      JSON.stringify({
        exportPath: "src/api",
        prefix: "Acme",
        excludedModules: ["sem-ver"],
      })
    );

    execFileSync(process.execPath, [cli], { cwd, encoding: "utf8" });

    // Excluded module was cleaned up
    assert.ok(!fs.existsSync(path.join(cwd, "src", "features", "sem-ver")));

    // Generated user hooks
    const userHooksPath = path.join(cwd, "src", "features", "user", "hooks", "use-query.ts");
    assert.ok(fs.existsSync(userHooksPath));
    const userHooks = fs.readFileSync(userHooksPath, "utf8");

    assert.match(userHooks, /^"use client";/);
    assert.match(userHooks, /Auto-generated by swagger-layer-query/);
    assert.match(userHooks, /import \{ AcmeUserService \} from "\.\.\/\.\.\/\.\.\/api\/user\/service";/);
    assert.match(userHooks, /import type \{ EUserRole \} from "\.\.\/\.\.\/\.\.\/api\/enums";/);
    assert.match(
      userHooks,
      /import type \{ CreateUserRequest, PagedResult, UserDto \} from "\.\.\/\.\.\/\.\.\/api\/types";/
    );
    // String union members like "Admin" must NOT be imported as types
    assert.doesNotMatch(userHooks, /\bAdmin\b.*from/);
    assert.match(userHooks, /export const userQueryKeys = \{/);
    assert.match(userHooks, /export function useGetAllUsersQuery\(/);
    assert.match(userHooks, /export function useGetUsersQuery\(\n  args\?: GetUsersArgs,/);
    assert.match(userHooks, /export function useGetUserByIdQuery\(\n  args: GetUserByIdArgs,/);
    assert.match(userHooks, /export function useCreateUserMutation\(/);
    assert.match(userHooks, /export function useSyncUsersMutation\(/);
    assert.match(userHooks, /export function useDeleteUserMutation\(/);
    assert.match(userHooks, /export function useResetCacheMutation\(/);

    // Barrel exports updated cleanly
    const hooksIndex = fs.readFileSync(
      path.join(cwd, "src", "features", "user", "hooks", "index.ts"),
      "utf8"
    );
    assert.equal(hooksIndex, `export * from "./use-query";\n`);

    const featureIndex = fs.readFileSync(
      path.join(cwd, "src", "features", "user", "index.ts"),
      "utf8"
    );
    assert.match(featureIndex, /export \* from "\.\/hooks";/);
    assert.match(featureIndex, /export const existingFeatureExport = true;/);

    // Model group skipped private method and only imported useQuery (no useMutation)
    const modelGroupHooks = fs.readFileSync(
      path.join(cwd, "src", "features", "model-group", "hooks", "use-query.ts"),
      "utf8"
    );
    assert.match(modelGroupHooks, /import \{ useQuery, type UseQueryOptions \} from "@tanstack\/react-query";/);
    assert.doesNotMatch(modelGroupHooks, /useMutation/);
    assert.doesNotMatch(modelGroupHooks, /internalHelper/);
    assert.match(modelGroupHooks, /export const modelGroupQueryKeys = \{/);

    // Verify all generated hooks pass strict TypeScript compilation!
    const testTsconfigPath = path.join(cwd, "tsconfig.json");
    fs.writeFileSync(
      testTsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      })
    );
    execFileSync(tscBin, ["-p", testTsconfigPath], { cwd, encoding: "utf8" });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("reads swaggerLayerQuery from config.json with importAlias, single-feature targeting (camelCase -> kebab-case), and --no-use-client", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-query-alias-"));
  try {
    createSampleApiFixture(cwd, "lib/data", "Rg");
    writeReactQueryStub(cwd);

    fs.writeFileSync(
      path.join(cwd, "config.json"),
      JSON.stringify({
        baseUrl: "https://api.example.com",
        prefix: "Rg",
        exportPath: "lib/data",
        excludedModules: ["sem-ver"],
        swaggerLayerQuery: {
          outputDir: "features",
          importAlias: "@/lib/data",
        },
      })
    );

    // Target "modelGroup" (camelCase) -> resolves to "model-group"
    execFileSync(process.execPath, [cli, "--name", "modelGroup", "--no-use-client"], {
      cwd,
      encoding: "utf8",
    });

    const mgHooksPath = path.join(cwd, "features", "model-group", "hooks", "use-query.ts");
    assert.ok(fs.existsSync(mgHooksPath));
    // Only model-group was generated, not user
    assert.ok(!fs.existsSync(path.join(cwd, "features", "user")));

    const content = fs.readFileSync(mgHooksPath, "utf8");
    assert.doesNotMatch(content, /^"use client";/);
    assert.match(content, /import \{ RgModelGroupService \} from "@\/lib\/data\/model-group\/service";/);
    assert.match(content, /import type \{ ModelGroupDto \} from "@\/lib\/data\/types";/);

    // Verify strict TypeScript with @/* paths alias!
    const testTsconfigPath = path.join(cwd, "tsconfig.json");
    fs.writeFileSync(
      testTsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          paths: { "@/*": ["./*"] },
          lib: ["ES2022", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["lib/**/*", "features/**/*"],
      })
    );
    execFileSync(tscBin, ["-p", testTsconfigPath], { cwd, encoding: "utf8" });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("errors when targeting an excluded or nonexistent feature or invalid swaggerLayerQuery config", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-query-err-"));
  try {
    createSampleApiFixture(cwd, "src/api", "App");

    assert.throws(() =>
      execFileSync(process.execPath, [cli, "--name", "sem-ver", "--exclude", "sem-ver"], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      })
    );

    assert.throws(() =>
      execFileSync(process.execPath, [cli, "--name", "does-not-exist"], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      })
    );

    fs.writeFileSync(
      path.join(cwd, "config.json"),
      JSON.stringify({ swaggerLayerQuery: "invalid" })
    );
    assert.throws(() =>
      execFileSync(process.execPath, [cli], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      })
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("programmatic API generateQueries and parseServiceContent work cleanly", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-query-prog-"));
  try {
    createSampleApiFixture(cwd, "src/api", "App");

    const result = await generateQueries({
      cwd,
      silent: true,
      config: {
        inputDir: "src/api",
        outputDir: "src/features",
        excludedModules: ["sem-ver"],
        queryMethodPrefixes: ["get", "list"],
      },
    });

    assert.equal(result.modules.length, 2);
    const userMod = result.modules.find((m) => m.moduleSlug === "user");
    assert.ok(userMod);
    assert.equal(userMod.queryCount, 3);
    assert.equal(userMod.mutationCount, 4);

    const parsed = parseServiceContent(
      `export class CustomOrderService {
        listOrders(page: number = 1): Promise<string[]> { return Promise.resolve([]); }
        cancelOrder(id: string): Promise<void> { return Promise.resolve(); }
      }`,
      "order",
      { queryMethodPrefixes: ["get", "list"] }
    );
    assert.ok(parsed);
    assert.equal(parsed.camelTag, "order");
    assert.equal(parsed.methods.length, 2);
    assert.equal(parsed.methods[0].isQuery, true);
    assert.equal(parsed.methods[0].params[0].optional, true);
    assert.equal(parsed.methods[1].isQuery, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
