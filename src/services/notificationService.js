import { EmbedBuilder } from "discord.js";

function getPlatformLabel(platform) {
    switch (platform) {
        case "tiktok":
            return "TikTok";
        case "twitch":
        default:
            return "Twitch";
    }
}

function getPlatformColor(platform, isLive = true) {
    if (!isLive) {
        return 0x808080;
    }

    switch (platform) {
        case "tiktok":
            return 0x000000;
        case "twitch":
        default:
            return 0x9146ff;
    }
}

async function resolveDiscordVisuals(client, discordUserId) {
    try {
        const user = await client.users.fetch(discordUserId, { force: true });

        return {
            avatarUrl: user.displayAvatarURL({ size: 1024, extension: "png" }),
            bannerUrl: user.bannerURL({ size: 1024, extension: "png" })
        };
    } catch {
        return {
            avatarUrl: null,
            bannerUrl: null
        };
    }
}

async function buildNotificationEmbed(client, config, data, options = {}) {
    const {
        isLive,
        statusText,
        fallbackTitle,
        fallbackUrl,
        fallbackThumbnailUrl,
        fallbackDisplayName,
        timestamp = new Date()
    } = options;

    const platformLabel = getPlatformLabel(config.platform);
    const title = data.title || fallbackTitle || (isLive ? "Live now" : "Stream ended");
    const streamUrl = data.url || fallbackUrl || null;
    const displayName = data.displayName || data.username || fallbackDisplayName || config.platformUsername || "Unknown";
    const thumbnailUrl = data.thumbnailUrl || fallbackThumbnailUrl || null;
    const discordVisuals = await resolveDiscordVisuals(client, config.discordUserId);

    const embed = new EmbedBuilder()
        .setColor(getPlatformColor(config.platform, isLive))
        .setTitle(`${isLive ? "🔴" : "⚫"} ${displayName} is ${isLive ? `now live on ${platformLabel}` : `offline on ${platformLabel}`}`)
        .setDescription(
            isLive
                ? `${streamUrl ? `[Watch now](${streamUrl})\n\n` : ""}**${title}**`
                : `**${title}**\n\nThis stream is currently offline.`
        )
        .addFields(
            { name: "Platform", value: platformLabel, inline: true },
            { name: "Streamer", value: displayName, inline: true },
            { name: "Status", value: statusText, inline: true }
        )
        .setTimestamp(timestamp);

    if (streamUrl) {
        embed.setURL(streamUrl);
    }

    if (thumbnailUrl) {
        embed.setImage(thumbnailUrl);
    } else if (discordVisuals.bannerUrl) {
        embed.setImage(discordVisuals.bannerUrl);
    }

    if (discordVisuals.avatarUrl) {
        embed.setThumbnail(discordVisuals.avatarUrl);
    }

    return embed;
}

export async function sendLiveNotification(client, config, liveData) {
    const channel = await client.channels.fetch(config.discordChannelId);

    if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${config.discordChannelId} is not a text channel.`);
    }

    const embed = await buildNotificationEmbed(client, config, liveData, {
        isLive: true,
        statusText: "Live"
    });

    const message = await channel.send({
        content: `<@${config.discordUserId}>`,
        embeds: [embed]
    });

    return {
        messageId: message.id,
        channelId: channel.id
    };
}

export async function updateLiveNotificationToOffline(client, config, state, liveData = {}) {
    if (!state?.lastNotificationMessageId || !state?.lastNotificationChannelId) {
        return false;
    }

    const channel = await client.channels.fetch(state.lastNotificationChannelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        return false;
    }

    const message = await channel.messages.fetch(state.lastNotificationMessageId).catch(() => null);

    if (!message) {
        return false;
    }

    const embed = await buildNotificationEmbed(client, config, liveData, {
        isLive: false,
        statusText: "Offline",
        fallbackTitle: state.lastTitle,
        fallbackUrl: state.lastStreamUrl,
        fallbackThumbnailUrl: state.lastThumbnailUrl,
        fallbackDisplayName: config.platformUsername,
        timestamp: new Date()
    });

    await message.edit({
        content: `<@&1466589257933127703>`,
        embeds: [embed]
    });

    return true;
}
