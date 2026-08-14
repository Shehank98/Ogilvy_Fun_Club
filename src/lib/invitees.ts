import { prisma } from "./prisma";
import { MAX_NAME_LENGTH, normaliseEmail, normaliseName } from "./assignment";

export type PublicInvitee = {
  id: string;
  email: string;
  name: string;
  /** Non-null once this address has been used to join. */
  memberId: string | null;
  teamNumber: number | null;
};

export async function loadInvitees(eventId: string): Promise<PublicInvitee[]> {
  const invitees = await prisma.invitee.findMany({
    where: { eventId },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    include: { member: { select: { id: true, team: { select: { teamNumber: true } } } } },
  });

  return invitees.map((invitee) => ({
    id: invitee.id,
    email: invitee.email,
    name: invitee.name,
    memberId: invitee.member?.id ?? null,
    teamNumber: invitee.member?.team.teamNumber ?? null,
  }));
}

export type ParsedGuestList = {
  entries: { email: string; name: string }[];
  /** One human-readable message per line that could not be used. */
  errors: string[];
};

/**
 * Parse a pasted guest list.
 *
 * Accepts one entry per line as `email, name`, which is what you get from
 * copying two columns out of a spreadsheet. Tabs and semicolons work as
 * separators too, since those are what a paste from Sheets or Excel actually
 * produces. A bare email with no name is accepted and falls back to the part
 * before the `@`, so a plain list of addresses still loads.
 *
 * Bad lines are reported rather than aborting the whole paste — one typo in a
 * list of forty should not cost the other thirty-nine.
 */
export function parseGuestList(text: string): ParsedGuestList {
  const entries: { email: string; name: string }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;

    // Skip a spreadsheet header row rather than reporting it as an error.
    if (index === 0 && /^e-?mail\b/i.test(line)) continue;

    const parts = line.split(/[\t,;]/);
    const email = normaliseEmail(parts[0] ?? "");

    if (!email) {
      errors.push(`line ${index + 1}: "${truncate(line)}" is not a valid email`);
      continue;
    }

    if (seen.has(email)) {
      errors.push(`line ${index + 1}: ${email} appears more than once`);
      continue;
    }
    seen.add(email);

    const rest = parts.slice(1).join(" ");
    const name = normaliseName(rest) || fallbackName(email);
    entries.push({ email, name });
  }

  return { entries, errors };
}

/** "ada.lovelace@club.test" -> "Ada Lovelace" */
function fallbackName(email: string): string {
  const local = email.slice(0, email.indexOf("@"));
  const words = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return normaliseName(words.join(" ")) || local.slice(0, MAX_NAME_LENGTH);
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}
