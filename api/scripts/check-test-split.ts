/**
 * Guards the unit/integration split.
 *
 * The suite is run in two halves — `test:unit` needs no database, `test:integration`
 * does. Splitting by directory is convenient and quietly fragile: a test file in a
 * directory neither half names is never executed, and the output still says
 * "passed". That has already happened twice on this project. Both times the
 * failure looked exactly like success.
 *
 * So this asserts the invariant directly: **every test file is claimed by exactly
 * one half.** Not zero (silently skipped), not two (run twice, and against a
 * database in one of them).
 *
 * Run by `npm test` before anything else, so the check cannot be forgotten.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Must match the filters in package.json exactly. */
const HALVES: Record<string, string[]> = {
  'test:unit': ['src/lib', 'src/middleware'],
  'test:integration': ['src/modules'],
};

// `__dirname`, not `import.meta.dirname`: this project compiles to CommonJS,
// where the latter does not exist. It happened to work under `tsx` and failed
// only under `npm run typecheck`, which is the wrong way round.
const ROOT = join(__dirname, '..');

function findTestFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findTestFiles(full));
    else if (entry.endsWith('.test.ts')) found.push(full);
  }

  return found;
}

const files = findTestFiles(join(ROOT, 'src')).map((f) =>
  relative(ROOT, f).split(sep).join('/'),
);

if (files.length === 0) {
  console.error('\n  No test files found at all. That is not a passing state.\n');
  process.exit(1);
}

const problems: string[] = [];

for (const file of files) {
  const claimedBy = Object.entries(HALVES)
    .filter(([, prefixes]) => prefixes.some((p) => file.startsWith(`${p}/`)))
    .map(([script]) => script);

  if (claimedBy.length === 0) {
    problems.push(
      `  ${file}\n` +
        `      Run by neither half — it will never execute, and the suite will still say "passed".\n` +
        `      Add its directory to one of the filters in package.json.`,
    );
  } else if (claimedBy.length > 1) {
    problems.push(`  ${file}\n      Claimed by ${claimedBy.join(' and ')}. It must belong to one.`);
  }
}

if (problems.length > 0) {
  console.error(`\n  Test split is broken:\n\n${problems.join('\n\n')}\n`);
  process.exit(1);
}

console.log(
  `test split: ${files.length} test files, all claimed ` +
    `(${Object.entries(HALVES)
      .map(([s, p]) => `${s} → ${p.join(', ')}`)
      .join(' · ')})`,
);
