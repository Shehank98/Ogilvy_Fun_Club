import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTIONS,
  adminPin,
  checkPin,
  sessionToken,
} from "@/lib/auth";
import { asString, fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const pin = adminPin();
  if (!pin) {
    return fail(
      "Admin access is not configured. Set the ADMIN_PIN environment variable.",
      503
    );
  }

  const body = await readJson(request);
  if (!checkPin(asString(body.pin))) {
    return fail("Incorrect PIN.", 401);
  }

  const store = await cookies();
  store.set(ADMIN_COOKIE, sessionToken(pin), ADMIN_COOKIE_OPTIONS);
  return ok({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return ok({ ok: true });
}
