/**
 * Fails the build if any locale drifts from English.
 *
 * A missing key renders as a fallback string in front of a user, in one of five
 * languages, and nobody notices until a customer does. This runs in CI.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'app', 'locales');
const REFERENCE = 'en';

function flatten(value, prefix = '') {
  const keys = new Set();

  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      for (const nested of flatten(entry, path)) keys.add(nested);
    } else {
      keys.add(path);
    }
  }

  return keys;
}

const load = (locale) => JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8'));

const locales = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace('.json', ''));

const reference = flatten(load(REFERENCE));
const problems = [];

console.log(`Reference "${REFERENCE}": ${reference.size} keys\n`);

for (const locale of locales) {
  const keys = flatten(load(locale));
  const missing = [...reference].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !reference.has(key));

  console.log(`${missing.length || extra.length ? '✗' : '✓'} ${locale.padEnd(3)} ${keys.size} keys`);

  if (missing.length) problems.push(`${locale}: missing ${missing.join(', ')}`);
  if (extra.length) problems.push(`${locale}: unexpected ${extra.join(', ')}`);
}

if (problems.length) {
  console.error('\nTranslation drift:');
  problems.forEach((problem) => console.error(`  • ${problem}`));
  process.exit(1);
}

console.log('\nAll locales consistent.');
