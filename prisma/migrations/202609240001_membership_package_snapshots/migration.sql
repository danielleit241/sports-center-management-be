-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "packageNameSnapshot" TEXT;
ALTER TABLE "Membership" ADD COLUMN "sportTypeSnapshot" TEXT;
ALTER TABLE "Membership" ADD COLUMN "durationDaysSnapshot" INTEGER;
ALTER TABLE "Membership" ADD COLUMN "listedPriceSnapshot" INTEGER;

-- Preserve the package values as they exist at migration time for historical rows.
UPDATE "Membership"
SET "packageNameSnapshot" = (SELECT "name" FROM "MembershipPackage" WHERE "MembershipPackage"."id" = "Membership"."packageId"),
    "sportTypeSnapshot" = (SELECT "sportType" FROM "MembershipPackage" WHERE "MembershipPackage"."id" = "Membership"."packageId"),
    "durationDaysSnapshot" = (SELECT "durationDays" FROM "MembershipPackage" WHERE "MembershipPackage"."id" = "Membership"."packageId"),
    "listedPriceSnapshot" = (SELECT "price" FROM "MembershipPackage" WHERE "MembershipPackage"."id" = "Membership"."packageId")
WHERE "packageId" IS NOT NULL;
