-- CreateEnum
CREATE TYPE "StreamPlatform" AS ENUM ('twitch', 'tiktok');

-- CreateTable
CREATE TABLE "StreamWatchConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "platform" "StreamPlatform" NOT NULL,
    "platformUsername" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamWatchConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamWatchState" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "lastStreamId" TEXT,
    "lastTitle" TEXT,
    "lastThumbnailUrl" TEXT,
    "lastStreamUrl" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastAnnouncedAt" TIMESTAMP(3),

    CONSTRAINT "StreamWatchState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamWatchConfig_guildId_idx" ON "StreamWatchConfig"("guildId");

-- CreateIndex
CREATE INDEX "StreamWatchConfig_platform_platformUsername_idx" ON "StreamWatchConfig"("platform", "platformUsername");

-- CreateIndex
CREATE UNIQUE INDEX "StreamWatchConfig_guildId_discordUserId_platform_key" ON "StreamWatchConfig"("guildId", "discordUserId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "StreamWatchState_configId_key" ON "StreamWatchState"("configId");

-- AddForeignKey
ALTER TABLE "StreamWatchState" ADD CONSTRAINT "StreamWatchState_configId_fkey" FOREIGN KEY ("configId") REFERENCES "StreamWatchConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
