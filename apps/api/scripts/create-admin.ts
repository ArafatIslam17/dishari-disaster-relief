/** `pnpm admin:create`: creates the first System Administrator for a production install (C3). */
import { eq } from 'drizzle-orm';
import { normalisePhone, passwordSchema, uuidv7 } from '@relief/shared';
import { hashPassword } from '../src/auth/tokens.js';
import { loadEnvFile } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { appUser } from '../src/db/schema.js';

loadEnvFile();
const mobile = normalisePhone(process.env.SEED_ADMIN_MOBILE ?? '');
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
if (!mobile || !passwordSchema.safeParse(password).success || password.startsWith('CHANGE_ME')) {
  console.error('Set SEED_ADMIN_MOBILE and a strong SEED_ADMIN_PASSWORD (8+ chars, letters and digits) in .env.');
  process.exit(1);
}
const handle = await openDatabase(process.env.DATABASE_URL as string, { max: 1 });
const [existing] = await handle.db.select().from(appUser).where(eq(appUser.mobileNumber, mobile));
if (existing) {
  console.info(`An account with ${mobile} already exists (role ${existing.role}).`);
} else {
  await handle.db.insert(appUser).values({
    id: uuidv7(),
    fullName: 'System Administrator',
    mobileNumber: mobile,
    passwordHash: await hashPassword(password),
    role: 'SYSTEM_ADMINISTRATOR',
    status: 'active',
  });
  console.info(`System Administrator created for ${mobile}.`);
}
await handle.close();
