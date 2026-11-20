import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time, length-safe secret comparison (both sides are hashed to equal-length digests). */
export function secretsMatch(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}
