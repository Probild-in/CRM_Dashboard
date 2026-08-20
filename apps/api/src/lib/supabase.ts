import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * The service-role Supabase client.
 *
 * It bypasses every policy, so it must never be handed to a browser and never
 * be constructed from request input. Sessions are disabled: this client acts as
 * the server, not as a signed-in person.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * Confirms a password without touching the admin client.
 *
 * `signInWithPassword` mutates the auth state of whichever client makes the
 * call — even with `persistSession: false`. Calling it on `supabaseAdmin` would
 * silently demote the shared service-role client to that user for the rest of
 * the process, so every later Storage and Admin call would fail against RLS.
 *
 * A throwaway client with the publishable key avoids that, and needs no
 * privilege beyond signing in.
 */
export async function passwordIsCorrect(email: string, password: string): Promise<boolean> {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

/** Supabase reports an existing address through the error, not a status code. */
function isAlreadyRegistered(message: string | undefined): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return text.includes('already registered') || text.includes('already been registered');
}

/**
 * Finds an auth account by email.
 *
 * `listUsers` is paginated and has no email filter, so this walks pages. In
 * practice Probild has a handful of staff accounts, and this is only reached on
 * the rare create-collision path.
 */
async function findAuthUserByEmail(email: string): Promise<string | null> {
  const wanted = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw new Error(`Could not reach Supabase Auth: ${error.message}`);
    }

    const match = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }

  return null;
}

/**
 * Creates the auth account and returns its id, or returns the id of the account
 * already holding that address.
 *
 * Idempotent on purpose: the seed runs repeatedly, and a half-created user —
 * present in `auth.users` but not in `users` — must be recoverable rather than
 * a permanent block.
 */
export async function ensureAuthUser(
  email: string,
  password: string,
  options: { warnIfExisting?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!error && data.user) {
    return data.user.id;
  }

  if (!isAlreadyRegistered(error?.message)) {
    throw new Error(`Could not create the auth account for ${email}: ${error?.message}`);
  }

  const existing = await findAuthUserByEmail(email);
  if (!existing) {
    throw new Error(
      `Supabase reports ${email} is already registered but the account could not be found.`,
    );
  }

  /*
   * The account is reused as-is; its password is NOT changed. Silently ignoring
   * a different password is how someone ends up certain the seed set one thing
   * while Supabase holds another — so say it out loud.
   */
  if (options.warnIfExisting) {
    console.warn(
      `! ${email} already exists in Supabase Auth. Its EXISTING password is unchanged — ` +
        `the value in SEED_ADMIN_PASSWORD was not applied. Sign in with the original ` +
        `password, or reset it from Supabase Dashboard → Authentication → Users.`,
    );
  }

  return existing;
}

/** Removes an auth account. Used when the profile write fails after creation. */
export async function deleteAuthUser(id: string): Promise<void> {
  await supabaseAdmin.auth.admin.deleteUser(id);
}

/** Sets a new password on an existing auth account. */
export async function setAuthPassword(id: string, password: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
  if (error) {
    throw new Error(`Could not update the password: ${error.message}`);
  }
}
