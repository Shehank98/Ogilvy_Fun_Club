import { readStoredFile } from "@/lib/uploads";

export const runtime = "nodejs";

/** Serves logos stored on disk (or on a mounted Railway volume). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const file = await readStoredFile(filename);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      // Filenames are random UUIDs, so a new upload is always a new URL.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
