-- CreateTable
CREATE TABLE "BankDetail" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT,
    "branch" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankDetail_employeeId_key" ON "BankDetail"("employeeId");

-- AddForeignKey
ALTER TABLE "BankDetail" ADD CONSTRAINT "BankDetail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
