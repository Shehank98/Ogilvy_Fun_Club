import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Logo storage.
 *
 * Railway's container filesystem is wiped on every redeploy, so a logo written
 * to disk only survives if `UPLOAD_DIR` points at a mounted Railway volume.
 * Preferred setup is Cloudinary: set `CLOUDINARY_CLOUD_NAME` and
 * `CLOUDINARY_UPLOAD_PRESET` (an unsigned preset) and uploads go there instead,
 * with only the returned URL stored in the database.
 */

export const MAX_LOGO_BYTES = 4 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".uploads");
}

export function cloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET
  );
}

export function extensionFor(mimeType: string): string | null {
  return ALLOWED_TYPES[mimeType] ?? null;
}

export async function storeOnCloudinary(file: File): Promise<string> {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET!;

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", preset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cloudinary upload failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as { secure_url?: string; url?: string };
  const url = payload.secure_url ?? payload.url;
  if (!url) throw new Error("Cloudinary did not return a URL.");
  return url;
}

/** Write to the local upload dir and return the URL that serves it back. */
export async function storeOnDisk(file: File, extension: string): Promise<string> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), bytes);
  return `/api/uploads/${filename}`;
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function readStoredFile(
  filename: string
): Promise<{ body: Buffer; contentType: string } | null> {
  // Only ever serve a bare `<uuid>.<ext>` name from the upload dir — never a
  // caller-supplied path, which could otherwise escape with `..`.
  const match = /^([0-9a-fA-F-]{36})\.([a-z]{3,4})$/.exec(filename);
  if (!match) return null;

  const contentType = CONTENT_TYPES[match[2]];
  if (!contentType) return null;

  try {
    const body = await readFile(path.join(uploadDir(), filename));
    return { body, contentType };
  } catch {
    return null;
  }
}
