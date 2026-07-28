import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ofc_admin";
const TOKEN_MESSAGE = "ogilvy-fun-club-admin-v1";

/**
 * There is no user table — `/admin` is gated on a single shared PIN held in the
 * `ADMIN_PIN` env var. The session cookie is an HMAC derived from that PIN, so
 * it is verifiable without storing sessions and it does not leak the PIN itself.
 * Rotating `ADMIN_PIN` invalidates every outstanding cookie.
 */
export function adminPin(): string | null {
  const pin = process.env.ADMIN_PIN;
  return pin && pin.length > 0 ? pin : null;
}

export function sessionToken(pin: string): string {
  return createHmac("sha256", pin).update(TOKEN_MESSAGE).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkPin(submitted: string): boolean {
  const pin = adminPin();
  if (!pin) return false;
  return safeEqual(submitted, pin);
}

export async function isAdminRequest(): Promise<boolean> {
  const pin = adminPin();
  if (!pin) return false;
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  return safeEqual(token, sessionToken(pin));
}

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 12, // 12 hours — long enough for an event night.
} as const;
