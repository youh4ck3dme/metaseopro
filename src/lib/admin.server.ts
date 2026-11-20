// Server-only admin resolution. Fail-closed: env variables are read per call
// inside handlers, never at module top level.

export interface AdminUser {
  id: string;
}

function parseCsvList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Single source of truth for "is this user a platform admin".
 *
 * Decision is based ONLY on ADMIN_USER_IDS (comma-separated Supabase user
 * UUIDs, trimmed, empty entries ignored). When the list is missing, empty
 * (e.g. " , ") or the user/id is missing, the result is false (fail-closed).
 *
 * There is deliberately NO email fallback: Supabase does not put
 * email_verified/email_confirmed_at into top-level JWT claims, so an email
 * check could be spoofed by registering with an admin address. user_metadata
 * and app_metadata are never used for the admin decision either.
 */
export function isAdminUser(user: AdminUser | null | undefined): boolean {
  if (!user || !user.id) return false;
  const adminIds = parseCsvList(process.env.ADMIN_USER_IDS);
  if (adminIds.length === 0) return false;
  return adminIds.includes(user.id);
}
