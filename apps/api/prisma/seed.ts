import { UserRole, UserStatus } from '@probild/shared';
import { env } from '../src/config/env.js';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { ensureAuthUser } from '../src/lib/supabase.js';

/** Probild's standing service catalogue; quotations and projects reference these. */
const SERVICES = [
  { name: 'Web Development', description: 'Custom websites and web applications.' },
  { name: 'Mobile App Development', description: 'iOS and Android applications.' },
  { name: 'UI/UX Design', description: 'Product design, prototyping and design systems.' },
  { name: 'Branding & Identity', description: 'Logo, brand guidelines and collateral.' },
  { name: 'Digital Marketing', description: 'Performance marketing and campaign management.' },
  { name: 'SEO', description: 'Technical and content search optimisation.' },
  { name: 'Maintenance & Support', description: 'Ongoing retainers and support.' },
];

const SETTINGS = [
  {
    key: 'company.profile',
    value: { name: 'Probild', timezone: env.DEFAULT_TIMEZONE, defaultCurrency: env.DEFAULT_CURRENCY },
    description: 'Company identity shown across the app',
    isPublic: true,
  },
  {
    key: 'automation.reminder_offsets',
    value: { daysBefore: [3, 1], hoursBefore: [2], onDue: true, overdue: true },
    description: 'Reminder schedule used by the automation engine',
    isPublic: false,
  },
  {
    key: 'quotation.defaults',
    value: { validityDays: 15, taxPercent: 18, paymentTerms: '50% advance, 50% on delivery' },
    description: 'Defaults applied to new quotations',
    isPublic: true,
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main(): Promise<void> {
  // Supabase owns the credential; the profile row below shares its id.
  const authId = await ensureAuthUser(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { email: env.SEED_ADMIN_EMAIL },
    update: { id: authId },
    create: {
      id: authId,
      email: env.SEED_ADMIN_EMAIL,
      firstName: env.SEED_ADMIN_FIRST_NAME,
      lastName: env.SEED_ADMIN_LAST_NAME,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      timezone: env.DEFAULT_TIMEZONE,
      designation: 'Administrator',
    },
    select: { id: true, email: true },
  });
  console.log(`✔ Super admin ready: ${admin.email}`);

  for (const service of SERVICES) {
    await prisma.service.upsert({
      where: { slug: slugify(service.name) },
      update: {},
      create: { ...service, slug: slugify(service.name), currency: env.DEFAULT_CURRENCY },
    });
  }
  console.log(`✔ ${SERVICES.length} services ready`);

  for (const setting of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { description: setting.description, isPublic: setting.isPublic },
      create: setting,
    });
  }
  console.log(`✔ ${SETTINGS.length} system settings ready`);
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
