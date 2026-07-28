import { cookies } from "next/headers";
import { prisma } from "./prisma";

/**
 * One entry per person.
 *
 * The signup link goes out by email and there are no accounts, so the entry is
 * pinned to the browser that used it: joining sets a cookie holding the member
 * id, and any later visit is sent straight to that person's result page instead
 * of a fresh form.
 *
 * The cookie is only ever trusted after checking the member still exists, which
 * is what makes admin removal work — take someone off the list and their next
 * visit sees the name form again, with no cookie clearing needed.
 */
export const ENTRY_COOKIE = "ofc_entry";

export const ENTRY_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 days — well past the event.
} as const;

/**
 * The member id this browser already used, or null if it has no entry yet or
 * the organiser has since removed it.
 */
export async function existingEntry(): Promise<string | null> {
  const store = await cookies();
  const memberId = store.get(ENTRY_COOKIE)?.value;
  if (!memberId) return null;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true },
  });

  // Removed by an organiser, or wiped by a reset — they get another go.
  return member?.id ?? null;
}
