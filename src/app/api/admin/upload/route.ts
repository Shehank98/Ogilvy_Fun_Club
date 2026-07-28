import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, toPublicEvent } from "@/lib/event";
import { fail, ok } from "@/lib/api";
import {
  MAX_LOGO_BYTES,
  cloudinaryConfigured,
  extensionFor,
  storeOnCloudinary,
  storeOnDisk,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Expected a file upload.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file was attached.", 400);

  if (file.size === 0) return fail("That file is empty.", 400);
  if (file.size > MAX_LOGO_BYTES) {
    return fail(`Logo must be under ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)}MB.`, 413);
  }

  const extension = extensionFor(file.type);
  if (!extension) {
    return fail("Use a PNG, JPEG, WebP, GIF or SVG image.", 415);
  }

  let logoUrl: string;
  try {
    logoUrl = cloudinaryConfigured()
      ? await storeOnCloudinary(file)
      : await storeOnDisk(file, extension);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return fail(message, 502);
  }

  const event = await getOrCreateEvent();
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: { logoUrl },
  });

  return ok({
    event: toPublicEvent(updated),
    storage: cloudinaryConfigured() ? "cloudinary" : "disk",
  });
}
