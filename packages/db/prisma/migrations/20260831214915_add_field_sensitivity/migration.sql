-- CreateEnum
CREATE TYPE "FieldSensitivity" AS ENUM ('NORMAL', 'CONFIDENTIAL', 'RESTRICTED');

-- AlterTable
ALTER TABLE "field_definition" ADD COLUMN     "sensitivity" "FieldSensitivity" NOT NULL DEFAULT 'CONFIDENTIAL';

-- The column default is deliberately CONFIDENTIAL, which is the right answer
-- for a field nobody has classified but wrong for the few system fields that
-- carry no personal data. Bring existing rows into line with the declarations
-- in packages/core/src/schema/system-fields.ts, or the same key would mean
-- different things depending on whether an account predates this migration.
--
-- Scoped to SYSTEM_DEFAULT rows so this cannot override a classification
-- someone chose deliberately.
UPDATE "field_definition"
SET "sensitivity" = 'NORMAL'
WHERE "source" = 'SYSTEM_DEFAULT'
  AND "key" IN ('pay_basis');
