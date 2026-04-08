import { prisma } from "../db/prisma.js";

function getStateResetData() {
    return {
        isLive: false,
        lastStreamId: null,
        lastTitle: null,
        lastThumbnailUrl: null,
        lastStreamUrl: null,
        lastNotificationMessageId: null,
        lastNotificationChannelId: null,
        lastCheckedAt: null,
        lastAnnouncedAt: null
    };
}

export async function upsertStreamConfig({
    guildId,
    discordUserId,
    discordChannelId,
    platform,
    platformUsername
}) {
    return prisma.$transaction(async tx => {
        const existingConfig = await tx.streamWatchConfig.findUnique({
            where: {
                guildId_discordUserId_platform: {
                    guildId,
                    discordUserId,
                    platform
                }
            },
            include: {
                state: true
            }
        });

        const didUsernameChange =
            existingConfig && existingConfig.platformUsername !== platformUsername;

        const config = await tx.streamWatchConfig.upsert({
            where: {
                guildId_discordUserId_platform: {
                    guildId,
                    discordUserId,
                    platform
                }
            },
            update: {
                discordChannelId,
                platformUsername,
                isActive: true,
                ...(didUsernameChange
                    ? {
                        eulerAlertId: null,
                        eulerTargetId: null
                    }
                    : {})
            },
            create: {
                guildId,
                discordUserId,
                discordChannelId,
                platform,
                platformUsername,
                state: {
                    create: {}
                }
            },
            include: {
                state: true
            }
        });

        if (didUsernameChange && config.state) {
            await tx.streamWatchState.update({
                where: { configId: config.id },
                data: getStateResetData()
            });

            return tx.streamWatchConfig.findUnique({
                where: { id: config.id },
                include: { state: true }
            });
        }

        return config;
    });
}

export async function getStreamConfig({
    guildId,
    discordUserId,
    platform
}) {
    return prisma.streamWatchConfig.findUnique({
        where: {
            guildId_discordUserId_platform: {
                guildId,
                discordUserId,
                platform
            }
        },
        include: {
            state: true
        }
    });
}

export async function removeStreamConfig({
    guildId,
    discordUserId,
    platform
}) {
    return prisma.streamWatchConfig.delete({
        where: {
            guildId_discordUserId_platform: {
                guildId,
                discordUserId,
                platform
            }
        }
    });
}

export async function getGuildStreamConfigs(guildId) {
    return prisma.streamWatchConfig.findMany({
        where: { guildId },
        include: { state: true },
        orderBy: { createdAt: "asc" }
    });
}

export async function getActiveStreamConfigsByPlatform(platform) {
    return prisma.streamWatchConfig.findMany({
        where: {
            platform,
            isActive: true
        },
        include: {
            state: true
        }
    });
}

export async function findActiveTikTokConfigsByUsername(platformUsername) {
    return prisma.streamWatchConfig.findMany({
        where: {
            platform: "tiktok",
            platformUsername,
            isActive: true
        },
        include: {
            state: true
        }
    });
}

export async function findActiveTikTokConfigsByAlertId(eulerAlertId) {
    if (!eulerAlertId) {
        return null;
    }

    return prisma.streamWatchConfig.findMany({
        where: {
            platform: "tiktok",
            eulerAlertId,
            isActive: true
        },
        include: {
            state: true
        }
    });
}


export async function countOtherActiveTikTokConfigs({ excludeConfigId, eulerAlertId, platformUsername }) {
    return prisma.streamWatchConfig.count({
        where: {
            platform: "tiktok",
            isActive: true,
            id: { not: excludeConfigId },
            OR: [
                ...(eulerAlertId ? [{ eulerAlertId }] : []),
                ...(platformUsername ? [{ platformUsername }] : [])
            ]
        }
    });
}

export async function setStreamConfigEulerSubscription(configId, { eulerAlertId, eulerTargetId }) {
    return prisma.streamWatchConfig.update({
        where: { id: configId },
        data: {
            eulerAlertId,
            eulerTargetId
        },
        include: {
            state: true
        }
    });
}

export async function clearStreamConfigEulerSubscription(configId) {
    return prisma.streamWatchConfig.update({
        where: { id: configId },
        data: {
            eulerAlertId: null,
            eulerTargetId: null
        },
        include: {
            state: true
        }
    });
}

export async function updateStreamState(configId, data) {
    return prisma.streamWatchState.update({
        where: { configId },
        data
    });
}
