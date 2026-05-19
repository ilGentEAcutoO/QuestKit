/**
 * copy-embed.mjs — turbo-tracked build step for @questkit/playground.
 *
 * The playground is a static-asset Worker that serves the @questkit/embed
 * IIFE bundle alongside 3 demo HTML pages. Rather than committing the
 * built JS file (it's a generated artifact) we copy it from the embed
 * package's dist/ at build time. The embed package is declared as a
 * workspace dependency in package.json so Turborepo's `^build` rule
 * guarantees the dist file is fresh before this script runs.
 *
 * Why a copy and not a symlink:
 *   - Windows symlinks need elevated privileges by default; forkers on
 *     Windows would hit a confusing "EPERM symlink" without --dev or admin.
 *   - Wrangler's [assets] binding scans the directory at deploy time, so
 *     a plain file works identically to a symlink for the Worker runtime.
 *
 * Behaviour:
 *   - Source missing -> exit 1 with a clear message that names the build
 *     command to run.
 *   - Source present -> copyFileSync (overwrites) and log "[playground]
 *     copied questkit.iife.js (XX.XX KB)" so CI logs show the size.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SRC = resolve(__dirname, '../../../packages/embed/dist/questkit.iife.js');
const DEST = resolve(__dirname, '../public/questkit.iife.js');

if (!existsSync(SRC)) {
  console.error(
    '[playground] embed dist not found at',
    SRC,
    '\n[playground] run `pnpm --filter @questkit/embed build` first ' +
      '(or `pnpm -w build` for the whole graph).',
  );
  process.exit(1);
}

mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(SRC, DEST);

const bytes = statSync(DEST).size;
const kb = (bytes / 1024).toFixed(2);
console.log(`[playground] copied questkit.iife.js (${kb} KB, ${bytes} bytes)`);
