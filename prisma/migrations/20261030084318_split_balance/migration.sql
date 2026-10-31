-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "redraw" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "offsetOrder" SET DEFAULT 'auto';

-- AlterTable
ALTER TABLE "LoanSplit" ADD COLUMN     "balanceAmount" DECIMAL(14,2),
ADD COLUMN     "balanceDate" TIMESTAMP(3);
