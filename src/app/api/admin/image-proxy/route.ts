import { isAdminRequest } from "@/lib/auth";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Same-origin image proxy, used only so the admin panel can read a team logo's
 * pixels onto a canvas to sample its dominant colour. Fetching an arbitrary
 * host's image directly into a canvas taints it (no CORS), which blocks the
 * pixel read; streaming the bytes back through our own origin sidesteps that.
 *
 * Admin-gated, and restricted to http(s) URLs pointing at public hosts so it
 * can't be turned into an SSRF probe of the internal network.
 *
 * Query: `?url=<image url>`. Responds with the image bytes, or an error.
 */
export async function GET(request: Request) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail("Invalid image URL.", 400);
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return fail("Only http(s) image URLs are allowed.", 400);
  }
  if (isBlockedHost(target.hostname)) {
    return fail("That host is not allowed.", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "image/*" },
    });
  } catch {
    return fail("Could not fetch that image.", 502);
  } finally {
    clearTimeout(timer);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.startsWith("image/")) {
    return fail("That URL did not return an image.", 502);
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    return fail("That image is too large to sample.", 413);
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Block loopback, link-local and private ranges by hostname so the proxy can't
 * be pointed at the internal network. A best-effort guard: hostnames that
 * resolve to private IPs via DNS are not caught here, but the endpoint is
 * already behind the admin gate.
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}
