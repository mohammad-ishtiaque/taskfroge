/**
 * Seed — one organisation, one user per role, and one project they all share.
 *
 * The project matters. Without it a developer signs in, is a member of nothing,
 * and correctly sees an empty screen — which looks identical to the app being
 * broken. Seed data should demonstrate the product, not just populate a table.
 *
 * Idempotent, so `npm run db:seed` can be re-run without cleaning up first.
 */
// Prisma's CLI loads .env; Prisma Client does not. This script is run by tsx,
// not by the CLI, so it has to load it itself.
import 'dotenv/config';

import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

/** Local development only. Twelve characters, matching the real policy. */
const DEMO_PASSWORD = 'TaskForge123!';

const PEOPLE: { email: string; name: string; role: Role; locale: string }[] = [
  { email: 'pm@taskforge.test',     name: 'Priya Nair',       role: 'PROJECT_MANAGER', locale: 'en' },
  { email: 'dev@taskforge.test',    name: 'Rahim Chowdhury',  role: 'DEVELOPER',       locale: 'bn' },
  { email: 'client@taskforge.test', name: 'Nadia Karim',      role: 'CLIENT',          locale: 'en' },
];

async function main(): Promise<void> {
  console.log('\nSeeding TaskForge (M0)…\n');

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
  });

  const org = await prisma.organization.upsert({
    where: { slug: 'moob02' },
    update: {},
    create: {
      name: 'Moob02 Software',
      slug: 'moob02',
      timezone: 'Asia/Dhaka',
      locale: 'en',
    },
  });

  console.log(`  organisation   ${org.name}`);

  for (const person of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, passwordHash, isActive: true },
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        locale: person.locale,
        timezone: 'Asia/Dhaka',
      },
    });

    await prisma.membership.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: { role: person.role, status: 'ACTIVE' },
      create: { orgId: org.id, userId: user.id, role: person.role },
    });

    console.log(`  ${person.role.toLowerCase().padEnd(16)} ${person.email}`);
  }

  // ── A project all three share ───────────────────────────────────────────
  //
  // The PM creates it; the developer and client are members. This is what makes
  // the demo answer "what does a developer see?" rather than "why is it empty?".
  const pm = await prisma.user.findUniqueOrThrow({ where: { email: 'pm@taskforge.test' } });
  const dev = await prisma.user.findUniqueOrThrow({ where: { email: 'dev@taskforge.test' } });
  const client = await prisma.user.findUniqueOrThrow({ where: { email: 'client@taskforge.test' } });

  // Project.workspaceId is NOT NULL, so the workspace has to exist first.
  const workspace = await prisma.workspace.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'freshcart' } },
    update: {},
    create: {
      orgId: org.id,
      slug: 'freshcart',
      name: 'FreshCart',
      clientName: 'FreshCart Grocery Ltd',
    },
  });

  const project = await prisma.project.upsert({
    where: { orgId_key: { orgId: org.id, key: 'WEB' } },
    update: {},
    create: {
      orgId: org.id,
      workspaceId: workspace.id,
      key: 'WEB',
      name: 'FreshCart Storefront',
      description: 'Rebuild of the customer-facing shop.',
      createdById: pm.id,
      visibility: {
        // Open, but time tracking stays hidden — see docs/04-client-visibility.md.
        create: { preset: 'OPEN', showTimeTracking: false, updatedById: pm.id },
      },
    },
  });

  for (const user of [pm, dev, client]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
      update: {},
      create: { projectId: project.id, userId: user.id },
    });
  }

  console.log(`  project        ${project.key} — ${project.name} (all three are members)`);

  console.log(`\n  Password for all three: ${DEMO_PASSWORD}\n`);
  console.log('  Sign in as dev@taskforge.test to see the project from a developer\'s side.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
