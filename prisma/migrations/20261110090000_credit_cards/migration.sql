-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "cardRate" DECIMAL(6,4),
ADD COLUMN     "creditLimit" DECIMAL(14,2),
ADD COLUMN     "dueDay" INTEGER;

