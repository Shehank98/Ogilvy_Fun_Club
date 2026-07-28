-- AlterTable
ALTER TABLE "Event" ALTER COLUMN "introMessage" SET DEFAULT 'Welcome to Bowling Champs! The lanes are booked.';

-- Column defaults only apply to new rows, so an event created before this point
-- still holds the old copy and would keep rendering it (an em dash in the intro
-- card, or pool-era branding left over from before the bowling rebrand).
--
-- These updates match on the exact superseded default values, so they can only
-- ever touch text no organiser has edited. Anything typed in the admin panel is
-- left alone.
UPDATE "Event"
SET "introMessage" = 'Welcome to Bowling Champs! The lanes are booked.'
WHERE "introMessage" IN (
  'Welcome to Bowling Champs — lanes are booked!',
  'Welcome to the club pool night!'
);

UPDATE "Event"
SET "title" = 'Bowling Champs'
WHERE "title" = 'Pool Game Night';
