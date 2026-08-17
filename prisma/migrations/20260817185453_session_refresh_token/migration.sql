-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "refreshTokenExpires" TIMESTAMP(3),
ALTER COLUMN "accountOwner" DROP NOT NULL,
ALTER COLUMN "accountOwner" DROP DEFAULT,
ALTER COLUMN "collaborator" DROP DEFAULT,
ALTER COLUMN "emailVerified" DROP DEFAULT;
