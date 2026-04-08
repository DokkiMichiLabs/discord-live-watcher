-- AlterTable
ALTER TABLE "StreamWatchConfig" ADD COLUMN     "eulerAlertId" TEXT,
ADD COLUMN     "eulerTargetId" TEXT;

-- CreateIndex
CREATE INDEX "StreamWatchConfig_platform_eulerAlertId_idx" ON "StreamWatchConfig"("platform", "eulerAlertId");
