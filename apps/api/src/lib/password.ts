/**
 * Password policy.
 *
 * Hashing and verification moved to Supabase Auth, which owns credentials now.
 * The policy stays here because Probild still decides what it will accept, and
 * both the request schemas and the seed script must agree on one definition.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** At least 8 characters, with a letter, a digit and a symbol. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
