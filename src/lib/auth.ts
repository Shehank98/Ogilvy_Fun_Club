import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ofc_admin";
export const OWNER_COOKIE = "ofc_owner";
const TOKEN_MESSAGE = "ogilvy-fun-club-admin-v1";
const OWNER_TOKEN_MESSAGE = "ogilvy-fun-club-owner-v1";

/**
 * There is no user table — `/admin` is gated on a single shared PIN held in the
 * `ADMIN_PIN` env var. The session cookie is an HMAC derived from that PIN, so
 * it is verifiable without storing sessions and it does not leak the PIN itself.
 * Rotating `ADMIN_PIN` invalidates every outstanding cookie.
 *
 * There is also an optional second, higher tier — the "owner" — gated on a
 * separate `OWNER_PIN`. It grants everything an admin can do plus a few hidden
 * controls (e.g. moving someone onto a chosen team). The login flow is
 * identical for both PINs, so a regular admin can't tell the owner tier exists.
 */
export function adminPin(): string | null {
  const pin = process.env.ADMIN_PIN;
  return pin && pin.length > 0 ? pin : null;
}

export function ownerPin(): string | null {
  const pin = process.env.OWNER_PIN;
  return pin && pin.length > 0 ? pin : null;
}

export function sessionToken(pin: string): string {
  return createHmac("sha256", pin).update(TOKEN_MESSAGE).digest("hex");
}

export function ownerToken(pin: string): string {
  return createHmac("sha256", pin).update(OWNER_TOKEN_MESSAGE).digest("hex");
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

export function checkOwnerPin(submitted: string): boolean {
  const pin = ownerPin();
  if (!pin) return false;
  return safeEqual(submitted, pin);
}

/** True for a valid admin session — or a valid owner session, since an owner is also an admin. */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();

  const adminP = adminPin();
  if (adminP) {
    const token = store.get(ADMIN_COOKIE)?.value;
    if (token && safeEqual(token, sessionToken(adminP))) return true;
  }

  const ownerP = ownerPin();
  if (ownerP) {
    const token = store.get(OWNER_COOKIE)?.value;
    if (token && safeEqual(token, ownerToken(ownerP))) return true;
  }

  return false;
}

/** True only for a valid owner session — the hidden higher tier. */
export async function isOwnerRequest(): Promise<boolean> {
  const pin = ownerPin();
  if (!pin) return false;
  const store = await cookies();
  const token = store.get(OWNER_COOKIE)?.value;
  if (!token) return false;
  return safeEqual(token, ownerToken(pin));
}

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 12, // 12 hours — long enough for an event night.
} as const;
