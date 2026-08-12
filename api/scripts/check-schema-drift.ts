import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* ==========================================================================
   Does the schema describe a database that exists?
   --------------------------------------------------------------------------
   `schema.prisma` and `prisma/migrations/` are two descriptions of the same
   thing, and nothing compares them. Editing the schema without generating a
   migration is a single keystroke, produces no error, and typechecks — the
   generated client is built from the schema, so TypeScript agrees with the
   file that is wrong.

   It fails later, at runtime, as:

       The column `User.emailVerifiedAt` does not exist in the current database

   That exact line cost a full test run, twice: once for `emailVerifiedAt` and
   once for the SEC1 columns on `PasswordResetToken`. Both had been sitting in
   the schema for days. Both would have been caught here in under a second.

   The check is deliberately crude — it looks for the identifier anywhere in
   the applied SQL rather than parsing it. A rename that reuses an old name
   would slip past. That is a fair trade for a check with no dependencies that
   runs before every test, and it catches the mistake people actually make:
   adding something and forgetting the migration entirely.
   ========================================================================== */

const root = join(__dirname, '..');
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');

function migrationSql(): string {
  const dir = join(root, 'prisma/migrations');
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .map((entry) => {
      try {
        return readFileSync(join(dir, entry, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

const sql = migrationSql();
const problems: string[] = [];

/**
 * Every model name in the schema.
 *
 * Needed because a field whose *type* is a model is a relation, and relations
 * are not columns. The obvious test — "does the line say `@relation`" — misses
 * the back-reference half of a one-to-one, which is written bare:
 *
 *     visibility ProjectVisibility?
 *
 * That one field was the check's only false positive, and a checker that cries
 * wolf once is a checker people start passing `--force` to.
 */
const modelNames = new Set(
  Array.from(schema.matchAll(/^model (\w+) \{/gm), (m) => m[1] as string),
);

/* ── Models and their columns ───────────────────────────────────────────── */

for (const model of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const [, name, body] = model as unknown as [string, string, string];

  if (!sql.includes(`"${name}"`)) {
    problems.push(`model ${name} has no migration`);
    continue;
  }

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

    const declaration = /^(\w+)\s+(\w+)/.exec(line);
    if (!declaration) continue;

    const [, field, type] = declaration as unknown as [string, string, string];

    // Any field whose type is a model is a relation, not a column — whichever
    // side of it this is, and whether or not `@relation` appears on the line.
    if (modelNames.has(type)) continue;

    if (!sql.includes(`"${field}"`)) problems.push(`${name}.${field} has no migration`);
  }
}

/* ── Enums and their values ─────────────────────────────────────────────── */

for (const enumMatch of schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
  const [, name, body] = enumMatch as unknown as [string, string, string];

  if (!sql.includes(`"${name}"`)) {
    problems.push(`enum ${name} has no migration`);
    continue;
  }

  // A value added to an existing enum needs `ALTER TYPE ... ADD VALUE`, which
  // is the most commonly forgotten migration of all — the schema reads fine
  // and the insert fails.
  for (const value of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*$/gm)) {
    if (!sql.includes(`'${value[1]}'`)) {
      problems.push(`enum ${name}.${value[1]} has no migration`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    `\n  schema.prisma describes things the database does not have:\n\n` +
      problems.map((p) => `    · ${p}`).join('\n') +
      `\n\n  Generate the migration:  npx prisma migrate dev --name <what-you-added>\n` +
      `  Or, if the engines cannot download, write the SQL by hand under\n` +
      `  prisma/migrations/<timestamp>_<name>/migration.sql\n`,
  );
  process.exit(1);
}

console.log(`  ✓ schema.prisma and prisma/migrations agree`);
