# Swagger Layer Query

[![npm version](https://img.shields.io/npm/v/swagger-layer-query.svg)](https://www.npmjs.com/package/swagger-layer-query)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#package-specifications)
[![TanStack Query](https://img.shields.io/badge/TanStack%20Query-v5%20Ready-FF4154.svg)](https://tanstack.com/query)

**`swagger-layer-query`** is an enterprise-ready, zero-dependency TypeScript code generator and CLI tool that transforms service layer definitions (`service.ts`) into strongly typed **TanStack React Query** hooks (`useQuery` and `useMutation`), deterministic query key factories, and clean feature barrel exports.

Designed as the official companion to [`swagger-layer`](https://www.npmjs.com/package/swagger-layer), it eliminates repetitive data-fetching boilerplate across React and Next.js codebases while preserving strict end-to-end type safety from backend OpenAPI contracts down to UI components.

---

## Table of Contents

1. [Package Specifications](#package-specifications)
2. [Architecture & Data Flow](#architecture--data-flow)
3. [Key Capabilities](#key-capabilities)
4. [Prerequisites & Installation](#prerequisites--installation)
5. [Quick Start](#quick-start)
6. [Configuration Reference](#configuration-reference)
7. [CLI Reference](#cli-reference)
8. [Generated Output Structure](#generated-output-structure)
9. [React & Next.js Integration Guide](#react--nextjs-integration-guide)
10. [Programmatic Node.js API](#programmatic-nodejs-api)
11. [CI/CD & Project Root Automation](#cicd--project-root-automation)
12. [License](#license)

---

## Package Specifications

| Specification | Details |
| :--- | :--- |
| **Package Name** | `swagger-layer-query` |
| **CLI Binary** | `swagger-layer-query` (`npx swagger-layer-query`) |
| **Module Format** | Native ESM (`"type": "module"`) with full `.d.ts` type declarations |
| **Runtime Dependencies** | `0` (built exclusively on Node.js standard libraries) |
| **Node.js Engine** | `>= 20.0.0` |
| **Target Ecosystem** | React 18/19, Next.js (App & Pages Router), Vite, TypeScript (Strict Mode) |
| **Required App Peer** | `@tanstack/react-query` (v5 recommended) |
| **Companion Package** | [`swagger-layer`](https://www.npmjs.com/package/swagger-layer) (automatic configuration inheritance) |
| **License** | MIT |

---

## Architecture & Data Flow

`swagger-layer-query` acts as the UI state-management bridge on top of your typed service layer:

```text
OpenAPI / Swagger JSON
        │
        ▼  swagger-layer (or custom service layer)
┌───────────────────────────────────────────────┐
│  src/api/                                     │
│  ├── enums.ts          (EUserRole, ...)       │
│  ├── types.ts          (DTOs, Requests, ...)  │
│  └── <module>/                                │
│      └── service.ts    (AppUserService)       │
└───────────────────────┬───────────────────────┘
                        │
                        ▼  swagger-layer-query
┌───────────────────────────────────────────────┐
│  src/features/<module>/                       │
│  ├── index.ts          (barrel re-export)     │
│  └── hooks/                                   │
│      ├── index.ts      (barrel re-export)     │
│      └── use-query.ts  (Args, QueryKeys,      │
│                         use*Query,            │
│                         use*Mutation)         │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
             React / Next.js Components
```

---

## Key Capabilities

- **Automatic `swagger-layer` Integration:** Automatically discovers and inherits `exportPath` (mapped to `inputDir`), `prefix`, and `excludedModules` from a sibling `config.json` when `swaggerLayerQuery` overrides are not provided.
- **Strict TypeScript Parsing:** Uses balanced delimiter scanning (rather than fragile regexes) to accurately parse `async` methods, nested generics (`Promise<PagedResult<UserDto>>`), inline query object signatures, string-literal unions, and default parameters while ignoring constructors, fields, and `private`/`protected`/`static` members.
- **Complete Type & Enum Resolution:** Detects referenced interfaces, type aliases, and enums from `types.ts` (or legacy `interfaces.ts`) and `enums.ts`, generating minimal, sorted `import type` statements.
- **Ergonomic Optional Arguments:** When all parameters of a service method are optional (e.g., `query?: { page?: number }`), generated query keys, `useQuery` hooks, and `useMutation` hooks allow zero-argument invocation without sacrificing type safety.
- **Flexible Import Strategy:** Supports both automatic relative POSIX import paths (works out of the box with any `tsconfig.json`) and custom path aliases (e.g., `@/lib/data`, `@/api`).
- **Targeted Feature Regeneration:** Regenerate hooks for a single domain module with intelligent name matching (`model-group`, `modelGroup`, `ModelGroup`, or `modelgroup`).
- **Automated Lifecycle Hygiene:** Maintains `hooks/index.ts` and `<feature>/index.ts` barrel exports without overwriting existing exports, and automatically removes stale hook files for excluded modules.
- **Next.js App Router Ready:** Emits `"use client";` by default (configurable via `useClient` or `--no-use-client`).

---

## Prerequisites & Installation

### Prerequisites

- **Node.js** `20.0.0` or higher
- **TypeScript** project with `@tanstack/react-query` installed
- Service classes organized as `<inputDir>/<module>/service.ts` (generated by `swagger-layer` or authored manually)

### Install

Install `swagger-layer-query` as a development dependency alongside `@tanstack/react-query` in your application:

**npm**
```bash
npm install --save-dev swagger-layer-query
npm install @tanstack/react-query
```

**pnpm**
```bash
pnpm add -D swagger-layer-query
pnpm add @tanstack/react-query
```

**yarn**
```bash
yarn add --dev swagger-layer-query
yarn add @tanstack/react-query
```

---

## Quick Start

### 1. Initialize Project Scripts

`swagger-layer-query` uses your existing **`config.json`** file and reads custom query settings from its optional **`"swaggerLayerQuery"`** object (while automatically inheriting top-level `exportPath`, `prefix`, and `excludedModules`).

Run `init` to automatically add the default generation scripts to your project's `package.json` (without overwriting existing scripts):

```bash
npx swagger-layer-query init
```

### 2. Configure Project Scripts

Running `npx swagger-layer-query init` adds these default scripts to `package.json`, or you can add them manually:

```json
{
  "scripts": {
    "generate:layer": "swagger-layer",
    "generate:query": "swagger-layer-query",
    "generate:sync": "npm run generate:layer && npm run generate:query"
  }
}
```

### 3. Generate Hooks

```bash
# Generate React Query hooks for all discovered service modules
npm run generate:query

# Regenerate API layer + React Query hooks together
npm run generate:sync

# Or regenerate hooks for a single feature module only
npx swagger-layer-query --name user
npx swagger-layer-query modelGroup
```

---

## Configuration Reference

All custom query settings live inside your project's **`config.json`** file under the **`"swaggerLayerQuery"`** object — keeping your entire API and React Query hooks setup in a single unified configuration file.

### Resolution Priority

Configuration values are merged in the following precedence order (highest priority first):

1. **CLI Flags** (e.g., `--input-dir`, `--output-dir`, `--import-alias`)
2. **Programmatic Overrides** (when invoked via the Node.js API)
3. **`"swaggerLayerQuery"` object** inside `config.json` (or `--config <path>`)
4. **Top-level `config.json` fields** (`exportPath`, `prefix`, and `excludedModules`)
5. **Built-in Defaults**

### `"swaggerLayerQuery"` Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`inputDir`** | `string` | `exportPath` / `"src/api"` | Directory containing `<module>/service.ts`, `types.ts`, and `enums.ts`. Inherits top-level `exportPath` if omitted. |
| **`outputDir`** | `string` | `"src/features"` | Root directory where per-module feature folders are written. |
| **`hooksSubDir`** | `string` | `"hooks"` | Subdirectory inside `<outputDir>/<module>/`. Set to `""` to write hook files directly inside `<outputDir>/<module>/`. |
| **`fileName`** | `string` | `"use-query.ts"` | Output filename for generated hook modules. |
| **`importAlias`** | `string` | `""` | Path alias prefix mapped to `inputDir` (e.g., `"@/lib/data"` or `"@/api"`). Leave empty (`""`) to compute clean relative import paths automatically. |
| **`prefix`** | `string` | top-level `prefix` / `""` | Service class prefix stripped when creating `<module>QueryKeys` (e.g., `"App"`, `"Rg"`). Inherits top-level `prefix` if omitted. |
| **`useClient`** | `boolean` | `true` | Prepends `"use client";` at the top of generated files for Next.js App Router compatibility. |
| **`excludedModules`** | `string[]` | top-level `excludedModules` / `[]` | List of module names/slugs to exclude from generation (matches exact, kebab-case, camelCase, or case-insensitive). Inherits top-level `excludedModules` if omitted. |
| **`queryMethodPrefixes`** | `string[]` | `["get"]` | Case-insensitive method name prefixes classified as `useQuery` hooks. All remaining public `Promise<T>` methods become `useMutation` hooks. |
| **`updateIndexFiles`** | `boolean` | `true` | Automatically creates/updates `hooks/index.ts` and appends `export * from "./hooks";` to existing `<feature>/index.ts` files. |
| **`cleanExcluded`** | `boolean` | `true` | Removes previously generated hook files (and empty directories) belonging to modules listed in `excludedModules`. |

### Unified `config.json` Examples

#### Example A — Next.js App Router with Path Alias (`@/lib/data`)

```json
{
  "swaggerLayerQuery": {
    "inputDir": "lib/data",
    "outputDir": "features",
    "hooksSubDir": "hooks",
    "fileName": "use-query.ts",
    "importAlias": "@/lib/data",
    "useClient": true,
    "queryMethodPrefixes": ["get"],
    "updateIndexFiles": true,
    "cleanExcluded": true
  }
}
```

#### Example B — Standard Vite / React SPA with Relative Imports

```json
{
  "swaggerLayerQuery": {
    "inputDir": "src/api",
    "outputDir": "src/features",
    "hooksSubDir": "hooks",
    "fileName": "use-query.ts",
    "importAlias": "",
    "useClient": false,
    "queryMethodPrefixes": ["get", "list", "find"]
  }
}
```

---

## CLI Reference

```bash
swagger-layer-query [feature] [options]
swagger-layer-query init
```

### Options Table

| Flag | Short | Argument | Description |
| :--- | :--- | :--- | :--- |
| `init` | — | — | Add default generation scripts (`generate:layer`, `generate:query`, `generate:sync`) to `package.json` |
| `--name`, `--feature` | `-n`, `-f` | `<NAME>` | Generate hooks for a single feature module (also accepted as a positional argument) |
| `--config` | `-c` | `<FILE>` | Path to a custom JSON configuration file (default: `config.json`) |
| `--input`, `--input-dir`, `--data-dir` | `-i` | `<DIR>` | Override `inputDir` |
| `--output`, `--output-dir`, `--features-dir` | `-o` | `<DIR>` | Override `outputDir` |
| `--hooks-dir` | — | `<SUBDIR>` | Override `hooksSubDir` (supports `--hooks-dir=""`) |
| `--file-name` | — | `<NAME>` | Override `fileName` |
| `--import-alias` | — | `<ALIAS>` | Override `importAlias` (supports `--import-alias=""`) |
| `--prefix` | `-p` | `<PREFIX>` | Override `prefix` |
| `--exclude` | `-e` | `<A,B>` | Comma-separated list of modules to exclude |
| `--query-prefixes` | — | `<A,B>` | Comma-separated list of method prefixes treated as `useQuery` |
| `--use-client` | — | — | Enable `"use client";` directive (default) |
| `--no-use-client` | — | — | Disable `"use client";` directive |
| `--no-index` | — | — | Skip creating or updating barrel `index.ts` files |
| `--no-clean-excluded` | — | — | Skip removing stale hooks for excluded modules |
| `--help` | `-h` | — | Display CLI help documentation |
| `--version` | `-v` | — | Display installed package version |

### Common CLI Workflows

```bash
# Generate hooks for all modules using config.json
npx swagger-layer-query

# Generate hooks for a single feature (camelCase automatically resolves to kebab-case)
npx swagger-layer-query --name modelGroup

# Override directories and import alias on the fly
npx swagger-layer-query \
  --input-dir lib/data \
  --output-dir features \
  --import-alias "@/lib/data" \
  --exclude sem-ver,kernel

# Generate for a Vite React SPA without "use client"
npx swagger-layer-query --no-use-client --query-prefixes get,list
```

---

## Generated Output Structure

Given an input service at `src/api/user/service.ts`, `swagger-layer-query` produces the following structure:

```text
src/features/
└── user/
    ├── index.ts          # Prepends `export * from "./hooks";` if index.ts exists
    └── hooks/
        ├── index.ts      # `export * from "./use-query";`
        └── use-query.ts  # Args types, userQueryKeys, use*Query & use*Mutation hooks
```

### Example Generated `use-query.ts`

```ts
"use client";

// Auto-generated by swagger-layer-query from src/api/user/service.ts
// Requires @tanstack/react-query to be installed in the app.
import { useMutation, useQuery, type UseMutationOptions, type UseQueryOptions } from "@tanstack/react-query";
import { AppUserService } from "../../../api/user/service";
import type { EUserRole } from "../../../api/enums";
import type { CreateUserRequest, PagedResult, UserDto } from "../../../api/types";

const service = new AppUserService();

export type GetUsersArgs = {
  query?: { page?: number; role?: EUserRole };
};

export type GetUserByIdArgs = {
  id: string;
};

export type CreateUserArgs = {
  body: CreateUserRequest;
};

export const userQueryKeys = {
  all: ["user"] as const,
  getUsers: (args?: GetUsersArgs) => [...userQueryKeys.all, "getUsers", args] as const,
  getUserById: (args: GetUserByIdArgs) => [...userQueryKeys.all, "getUserById", args] as const,
};

export function useGetUsersQuery(
  args?: GetUsersArgs,
  options?: Omit<UseQueryOptions<PagedResult<UserDto>, Error>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: userQueryKeys.getUsers(args),
    queryFn: () => service.getUsers(args?.query),
    ...options,
  });
}

export function useGetUserByIdQuery(
  args: GetUserByIdArgs,
  options?: Omit<UseQueryOptions<UserDto, Error>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: userQueryKeys.getUserById(args),
    queryFn: () => service.getUserById(args.id),
    ...options,
  });
}

export function useCreateUserMutation(
  options?: UseMutationOptions<UserDto, Error, CreateUserArgs>
) {
  return useMutation({
    mutationFn: (args: CreateUserArgs) => service.createUser(args.body),
    ...options,
  });
}
```

---

## React & Next.js Integration Guide

### 1. Fetching Data with Queries

```tsx
import { EUserRole } from "@/api/enums";
import { useGetUsersQuery, useGetUserByIdQuery } from "@/features/user/hooks";

export function UserDirectory({ selectedUserId }: { selectedUserId?: string }) {
  // Optional parameters can be omitted or supplied selectively
  const { data, isLoading, error } = useGetUsersQuery({
    query: { page: 1, role: EUserRole.Admin },
  });

  // Pass any standard TanStack Query options (`enabled`, `staleTime`, `select`, etc.)
  const userDetail = useGetUserByIdQuery(
    { id: selectedUserId ?? "" },
    { enabled: Boolean(selectedUserId), staleTime: 60_000 }
  );

  if (isLoading) return <div>Loading users...</div>;
  if (error) return <div>Failed to load users: {error.message}</div>;

  return (
    <section>
      <ul>
        {data?.items.map((user) => (
          <li key={user.id}>{user.email}</li>
        ))}
      </ul>
      {userDetail.data && <p>Selected: {userDetail.data.email}</p>}
    </section>
  );
}
```

### 2. Performing Mutations & Cache Invalidation

Use the generated `<module>QueryKeys` factory to invalidate an entire domain or a targeted query entry upon mutation success:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { EUserRole } from "@/api/enums";
import { useCreateUserMutation, userQueryKeys } from "@/features/user/hooks";

export function CreateUserButton() {
  const queryClient = useQueryClient();

  const createUser = useCreateUserMutation({
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: userQueryKeys.all,
      });
    },
  });

  return (
    <button
      type="button"
      disabled={createUser.isPending}
      onClick={() =>
        createUser.mutate({
          body: { email: "developer@company.com", role: EUserRole.Member },
        })
      }
    >
      {createUser.isPending ? "Creating..." : "Create User"}
    </button>
  );
}
```

### 3. Prefetching & Server-Side Hydration

The exported query key factories can be shared across client components and server prefetch helpers:

```ts
import { QueryClient } from "@tanstack/react-query";
import { userService } from "@/api/user";
import { userQueryKeys } from "@/features/user/hooks";

export async function prefetchUsers(queryClient: QueryClient) {
  await queryClient.prefetchQuery({
    queryKey: userQueryKeys.getUsers({ query: { page: 1 } }),
    queryFn: () => userService.getUsers({ page: 1 }),
  });
}
```

---

## Programmatic Node.js API

`swagger-layer-query` exports its complete generation and parsing pipeline for custom build tools, monorepo scripts, or IDE plugins:

```ts
import { generateQueries } from "swagger-layer-query";

const result = await generateQueries({
  cwd: process.cwd(),
  name: "user", // Optional: omit to process all modules
  silent: false,
  config: {
    inputDir: "lib/data",
    outputDir: "features",
    importAlias: "@/lib/data",
    prefix: "Rg",
    useClient: true,
    excludedModules: ["sem-ver", "kernel"],
    queryMethodPrefixes: ["get"],
  },
});

for (const mod of result.modules) {
  console.log(
    `${mod.moduleSlug}: ${mod.hookCount} hooks (${mod.queryCount} queries, ${mod.mutationCount} mutations) -> ${mod.outputFilePath}`
  );
}
```

### Available Exports

| Export | Purpose |
| :--- | :--- |
| `generateQueries(options?)` | End-to-end orchestration for all modules or a targeted module |
| `generateQueriesForModule(slug, context)` | Generate hooks and barrel exports for a single module slug |
| `generateHooksCode(params)` | Pure code generator returning the TypeScript hook source string |
| `parseServiceFile(path, slug, options?)` | Read and parse a `service.ts` file into structured method metadata |
| `parseServiceContent(source, slug, options?)` | Parse raw `service.ts` source text without filesystem I/O |
| `readConfig(root, args?, overrides?)` | Resolve effective configuration using the standard precedence chain |
| `ensureDefaultPackageScripts(root)` | Add missing default generation scripts to `package.json` |

---

## CI/CD & Project Root Automation

### Environment Variable Override

In monorepo setups (e.g., Turborepo, Nx, pnpm workspaces), you can override the resolved workspace root via:

```bash
SWAGGER_LAYER_QUERY_PROJECT_ROOT=./apps/web npx swagger-layer-query
```

### Recommended Pipeline with `swagger-layer`

```json
{
  "scripts": {
    "generate:layer": "swagger-layer",
    "generate:query": "swagger-layer-query",
    "generate:sync": "npm run generate:layer && npm run generate:query",
    "generate:check": "npm run generate:sync && tsc --noEmit"
  }
}
```

Running `tsc --noEmit` immediately after generation guarantees in CI that every generated hook, argument type, and enum/DTO import remains strictly aligned with the latest OpenAPI contract.

---

## License

Licensed under the [MIT License](./LICENSE).

Copyright © 2026 Muammer Oner
