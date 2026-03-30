import { prisma } from "../db/prisma.js";

export async function upsertStreamConfig({
                                             guildId,
                                             discordUserId,
                                             discordChannelId,
                                             platform,
                                             platformUsername
                                         }) {
    const config = await prisma.streamWatchConfig.upsert({
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
            isActive: true
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

    return config;
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

export async function updateStreamState(configId, data) {
    return prisma.streamWatchState.update({
        where: { configId },
        data
    });
}