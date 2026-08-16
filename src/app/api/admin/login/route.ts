import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTIONS,
  OWNER_COOKIE,
  adminPin,
  checkOwnerPin,
  checkPin,
  ownerPin,
  ownerToken,
  sessionToken,
} from "@/lib/auth";
import { asString, fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = adminPin();
  const owner = ownerPin();
  if (!admin && !owner) {
    return fail(
      "Admin access is not configured. Set the ADMIN_PIN environment variable.",
      503
    );
  }

  const body = await readJson(request);
  const submitted = asString(body.pin);
  const store = await cookies();

  // Check the owner PIN first. The response is identical whichever PIN matched,
  // so nobody logging in can tell that a higher tier exists.
  if (owner && checkOwnerPin(submitted)) {
    store.set(OWNER_COOKIE, ownerToken(owner), ADMIN_COOKIE_OPTIONS);
    store.delete(ADMIN_COOKIE);
    return ok({ ok: true });
  }

  if (admin && checkPin(submitted)) {
    store.set(ADMIN_COOKIE, sessionToken(admin), ADMIN_COOKIE_OPTIONS);
    store.delete(OWNER_COOKIE);
    return ok({ ok: true });
  }

  return fail("Incorrect PIN.", 401);
}

export async function DELETE() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  store.delete(OWNER_COOKIE);
  return ok({ ok: true });
}
