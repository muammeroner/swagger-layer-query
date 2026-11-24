#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDefaultPackageScripts, parseArgs } from "../config.js";
import { generateQueries } from "../generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP_TEXT = `swagger-layer-query - Generate Type-Safe TanStack React Query Hooks from service.ts files

Usage:
  swagger-layer-query [feature] [options]
  swagger-layer-query init

Options:
  init                         Add default generation scripts to package.json
  -n, --name, -f, --feature    Generate hooks for a single feature/module (e.g. --name user)
  -c, --config <FILE>          Path to JSON configuration file (default: config.json)
  -i, --input, --input-dir     Directory containing <module>/service.ts files (default: swagger-layer exportPath or src/api)
  -o, --output, --output-dir   Target features output directory (default: src/features)
  --hooks-dir <SUBDIR>         Subdirectory inside each feature folder (default: hooks)
  --file-name <NAME>           Output hooks filename (default: use-query.ts)
  --import-alias <ALIAS>       Import alias for inputDir (e.g. @/lib/data); omit for relative imports
  -p, --prefix <PREFIX>        Service class prefix to strip for query keys (e.g. App, Rg)
  -e, --exclude <A,B>          Comma-separated modules to exclude
  --query-prefixes <A,B>       Comma-separated method prefixes treated as useQuery (default: get)
  --use-client                 Emit "use client"; directive at top of generated files (default)
  --no-use-client              Omit "use client"; directive
  --no-index                   Do not create or update barrel index.ts files
  --no-clean-excluded          Do not remove previously generated hooks for excluded modules
  -h, --help                   Display this help message
  -v, --version                Display package version`;

function readPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (args.versionFlag) {
    console.log(readPackageVersion());
    return;
  }

  if (args.init) {
    const scriptResult = ensureDefaultPackageScripts(process.cwd());
    if (!scriptResult) {
      console.log(`ℹ No package.json found in ${process.cwd()}`);
    } else if (scriptResult.addedScripts.length > 0) {
      console.log(
        `✓ Added default scripts to package.json: ${scriptResult.addedScripts.join(", ")}`
      );
    } else {
      console.log(`✓ Default scripts already present in package.json`);
    }
    return;
  }

  await generateQueries({ args });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[swagger-layer-query]", message);
  process.exitCode = 1;
});
