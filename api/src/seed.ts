/**
 * Seed — one organisation, one user per role, and one project they all share.
 *
 * The project matters. Without it a developer signs in, is a member of nothing,
 * and correctly sees an empty screen — which looks identical to the app being
 * broken. Seed data should demonstrate the product, not just populate a table.
 *
 * Idempotent, so `npm run db:seed` can be re-run without cleaning up first.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { connectDatabase, disconnectDatabase } from '../src/lib/db';
import {
  Organization,
  User,
  Membership,
  Workspace,
  Project,
  ProjectMember,
  ProjectVisibility,
  type Role,
} from '../src/models';

/** Local development only. Twelve characters, matching the real policy. */
const DEMO_PASSWORD = 'TaskForge123!';

const PEOPLE: { email: string; name: string; role: Role; locale: string }[] = [
  { email: 'pm@taskforge.test', name: 'Priya Nair', role: 'PROJECT_MANAGER', locale: 'en' },
  { email: 'dev@taskforge.test', name: 'Rahim Chowdhury', role: 'DEVELOPER', locale: 'bn' },
  { email: 'client@taskforge.test', name: 'Nadia Karim', role: 'CLIENT', locale: 'en' },
];

async function main(): Promise<void> {
  console.log('\nSeeding TaskForge (Mongoose/MongoDB)…\n');

  await connectDatabase();

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
  });

  let org = await Organization.findOne({ slug: 'moob02' });
  if (!org) {
    org = await Organization.create({
      name: 'Moob02 Software',
      slug: 'moob02',
      timezone: 'Asia/Dhaka',
      locale: 'en',
    });
  } else {
    org.name = 'Moob02 Software';
    await org.save();
  }

  console.log(`  organisation   ${org.name}`);

  const userMap: Record<string, typeof User.prototype> = {};

  for (const person of PEOPLE) {
    let user = await User.findOne({ email: person.email });
    if (!user) {
      user = await User.create({
        email: person.email,
        name: person.name,
        passwordHash,
        locale: person.locale,
        timezone: 'Asia/Dhaka',
        isActive: true,
      });
    } else {
      user.name = person.name;
      user.passwordHash = passwordHash;
      user.isActive = true;
      await user.save();
    }

    userMap[person.email] = user;

    await Membership.findOneAndUpdate(
      { orgId: org._id, userId: user._id },
      { orgId: org._id, userId: user._id, role: person.role, status: 'ACTIVE' },
      { upsert: true, new: true }
    );

    console.log(`  ${person.role.toLowerCase().padEnd(16)} ${person.email}`);
  }

  const pm = userMap['pm@taskforge.test']!;
  const dev = userMap['dev@taskforge.test']!;
  const client = userMap['client@taskforge.test']!;

  let workspace = await Workspace.findOne({ orgId: org._id, slug: 'freshcart' });
  if (!workspace) {
    workspace = await Workspace.create({
      orgId: org._id,
      slug: 'freshcart',
      name: 'FreshCart',
      clientName: 'FreshCart Grocery Ltd',
    });
  }

  let project = await Project.findOne({ orgId: org._id, key: 'WEB' });
  if (!project) {
    project = await Project.create({
      orgId: org._id,
      workspaceId: workspace._id,
      key: 'WEB',
      name: 'FreshCart Storefront',
      description: 'Rebuild of the customer-facing shop.',
      createdById: pm._id,
    });

    await ProjectVisibility.findOneAndUpdate(
      { projectId: project._id },
      {
        projectId: project._id,
        preset: 'OPEN',
        showTimeTracking: false,
        updatedById: pm._id,
      },
      { upsert: true, new: true }
    );
  }

  for (const user of [pm, dev, client]) {
    await ProjectMember.findOneAndUpdate(
      { projectId: project._id, userId: user._id },
      { projectId: project._id, userId: user._id },
      { upsert: true, new: true }
    );
  }

  console.log(`  project        ${project.key} — ${project.name} (all three are members)`);
  console.log(`\n  Password for all three: ${DEMO_PASSWORD}\n`);
  console.log("  Sign in as dev@taskforge.test to see the project from a developer's side.\n");
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDatabase();
  });
