#!/usr/bin/env node
/**
 * Test runner: Node's built-in test runner + tsx for TypeScript.
 *
 *   node scripts/run-tests.mjs                 # every *.test.ts under src/ and tests/
 *   node scripts/run-tests.mjs tests/integration
 *   node scripts/run-tests.mjs src/modules/deals
 *
 * `--conditions=react-server` makes `import "server-only"` resolve to an empty module,
 * exactly as it does inside Next.js server code.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const targets = process.argv.slice(2);
const roots = targets.length > 0 ? targets : ["src", "tests"];

function collect(path, out) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return;
  }
  if (stats.isFile()) {
    if (path.endsWith(".test.ts")) out.push(path);
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    collect(join(path, entry), out);
  }
}

const files = [];
for (const target of roots) collect(join(root, target), files);
files.sort();

if (files.length === 0) {
  console.error(`No *.test.ts files found under: ${roots.join(", ")}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "--test-reporter=spec",
    "--test-concurrency=4",
    ...files.map((f) => relative(root, f)),
  ],
  { stdio: "inherit", env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
      // Never let a test open the on-disk dev database.
      PGLITE_DATA_DIR: "memory://",
      DATABASE_URL: "",
      WHATSAPP_PROVIDER: "demo",
    },
  },
);

process.exit(result.status ?? 1);
