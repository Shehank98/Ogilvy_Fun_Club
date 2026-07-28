import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Railway's health check.
 *
 * Deliberately returns 200 whenever the process is serving, reporting database
 * reachability in the body rather than in the status code. The previous check
 * pointed at `/api/teams`, which reads *and writes* Postgres — so a slow or
 * briefly unavailable database failed the health check and Railway killed a
 * container that was otherwise fine.
 */
export async function GET() {
  let database: "ok" | "unreachable" = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }

  return Response.json(
    { status: "ok", database, timestamp: new Date().toISOString() },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
