import { EmbedBuilder } from "discord.js";
import { isBroadcastThumbnail } from "../platforms/twitch/twitchThumbnail.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

function notificationMention() {
    return env.discordNotificationRoleId
        ? { content: `<@&${env.discordNotificationRoleId}>` }
        : { content: "", allowedMentions: { parse: [] } };
}

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

export async function sendLiveNotification(client, config, liveData, image = null) {
    const channel = await client.channels.fetch(config.discordChannelId);

    if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${config.discordChannelId} is not a text channel.`);
    }

    const thumbnailUrl = image ? `attachment://${image.name}` : null;
    const embedData = config.platform === "twitch" ? { ...liveData, thumbnailUrl } : liveData;
    const embed = await buildNotificationEmbed(client, config, embedData, {
        isLive: true,
        statusText: "Live"
    });

    const payload = {
        ...notificationMention(),
        embeds: [embed],
        ...(image ? { files: [{ attachment: image.buffer, name: image.name }] } : {})
    };
    let message;
    let usedImage = Boolean(image);
    try {
        message = await channel.send(payload);
    } catch (error) {
        // Only retry definitive rejection, never an ambiguous network failure (duplicate risk).
        if (!image || ![400, 403, 413].includes(error.status)) throw error;
        logger.warn({ configId: config.id }, "Discord thumbnail upload rejected; sending fallback");
        const fallback = await buildNotificationEmbed(client, config, { ...liveData, thumbnailUrl: null }, { isLive: true, statusText: "Live" });
        message = await channel.send({ ...notificationMention(), embeds: [fallback] });
        usedImage = false;
    }

    return {
        messageId: message.id,
        channelId: channel.id,
        ...(config.platform === "twitch" ? { thumbnailUrl: usedImage ? thumbnailUrl : null } : {})
    };
}

export async function updateLiveNotificationToOffline(client, config, state, liveData = {}) {
    if (!state?.lastNotificationMessageId || !state?.lastNotificationChannelId) {
        return false;
    }

    let deleted = false;
    const channel = await client.channels.fetch(state.lastNotificationChannelId).catch(error => {
        deleted = config.platform === "twitch" && error.code === 10003;
        return null;
    });
    if (deleted) return { thumbnailUrl: null };

    if (!channel || !channel.isTextBased()) {
        return false;
    }

    const message = await channel.messages.fetch(config.platform === "twitch"
        ? { message: state.lastNotificationMessageId, force: true }
        : state.lastNotificationMessageId).catch(error => {
        deleted = config.platform === "twitch" && error.code === 10008;
        return null;
    });
    if (deleted) return { thumbnailUrl: null };

    if (!message) {
        return false;
    }

    const twitchAttachment = config.platform === "twitch"
        ? message.attachments.find(attachment => isBroadcastThumbnail(attachment.name, state.lastStreamId))
        : null;
    const offlineData = config.platform === "twitch"
        ? { ...liveData, thumbnailUrl: twitchAttachment ? `attachment://${twitchAttachment.name}` : null }
        : liveData;
    const embed = await buildNotificationEmbed(client, config, offlineData, {
        isLive: false,
        statusText: "Offline",
        fallbackTitle: state.lastTitle,
        fallbackUrl: state.lastStreamUrl,
        fallbackThumbnailUrl: config.platform === "twitch" ? null : state.lastThumbnailUrl,
        fallbackDisplayName: config.platformUsername,
        timestamp: new Date()
    });

    await message.edit({
        ...notificationMention(),
        embeds: [embed],
        ...(config.platform === "twitch" ? {
            attachments: [...message.attachments.values()].map(attachment => ({ id: attachment.id })),
            allowedMentions: { parse: [] }
        } : {})
    });

    return config.platform === "twitch" ? { thumbnailUrl: offlineData.thumbnailUrl } : true;
}

function embedReferencesAttachment(message, name) {
    const url = message.embeds[0]?.image?.url;
    if (url === `attachment://${name}`) return true;
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop()) === name;
    } catch {
        return false;
    }
}

export async function refreshTwitchNotificationImage(client, config, state, liveData, image) {
    if (state.lastStreamId !== liveData.streamId || !state.lastNotificationMessageId || !state.lastNotificationChannelId) return undefined;
    const channel = await client.channels.fetch(state.lastNotificationChannelId);
    if (!channel?.isTextBased()) return undefined;
    const message = await channel.messages.fetch({ message: state.lastNotificationMessageId, force: true });
    const existing = image ? message.attachments.find(attachment => attachment.name === image.name) : null;
    const preserved = message.attachments.find(attachment => isBroadcastThumbnail(attachment.name, liveData.streamId));
    const name = image?.name || preserved?.name;
    const reference = name ? `attachment://${name}` : null;
    // Detection state may already be live after a failed status-restoration edit.
    // Reconcile the actual message status even when the image has not changed.
    const restoreLive = !state.isLive || message.embeds[0]?.fields?.some(field => field.name === "Status" && field.value === "Offline");
    if (!restoreLive && (!image || (existing && embedReferencesAttachment(message, image.name)))) return reference;
    if (!message.embeds[0]) return undefined;
    const embed = restoreLive
        ? await buildNotificationEmbed(client, config, { ...liveData, thumbnailUrl: reference }, { isLive: true, statusText: "Live" })
        : EmbedBuilder.from(message.embeds[0]).setImage(reference);
    const upload = image && !existing;
    // Keep unrelated attachments, replacing only thumbnails for this broadcast.
    const attachments = [...message.attachments.values()]
        .filter(attachment => !upload || !isBroadcastThumbnail(attachment.name, liveData.streamId))
        .map(attachment => ({ id: attachment.id }));
    try {
        await message.edit({
            embeds: [embed],
            attachments,
            ...(upload ? { files: [{ attachment: image.buffer, name: image.name }] } : {}),
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        // An edit can commit before its response is lost. Reconcile against the server,
        // never the cached message whose attachment IDs may already have been removed.
        const latest = await channel.messages.fetch({ message: message.id, force: true }).catch(() => null);
        const confirmedLive = latest?.embeds[0]?.fields?.some(field => field.name === "Status" && field.value === "Live");
        if (name && confirmedLive && latest.attachments.some(attachment => attachment.name === name) && embedReferencesAttachment(latest, name)) return reference;
        throw error;
    }
    return reference;
}
