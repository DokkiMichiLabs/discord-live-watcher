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

function getPlatformColor(platform) {
    switch (platform) {
        case "tiktok":
            return 0x000000;
        case "twitch":
        default:
            return 0x9146ff;
    }
}

export async function sendLiveNotification(client, config, liveData) {
    const channel = await client.channels.fetch(config.discordChannelId);

    if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${config.discordChannelId} is not a text channel.`);
    }

    const platformLabel = getPlatformLabel(config.platform);

    const embed = new EmbedBuilder()
        .setColor(getPlatformColor(config.platform))
        .setTitle(`🔴 ${liveData.displayName} is now live on ${platformLabel}!`)
        .setDescription(`[Watch now](${liveData.url})\n\n**${liveData.title || "Live now"}**`)
        .addFields(
            { name: "Platform", value: platformLabel, inline: true },
            { name: "Streamer", value: liveData.displayName || liveData.username || "Unknown", inline: true },
            { name: "Status", value: "Live", inline: true }
        )
        .setURL(liveData.url)
        .setTimestamp(new Date());

    if (liveData.thumbnailUrl) {
        embed.setImage(liveData.thumbnailUrl);
    }

    await channel.send({
        content: `<@${config.discordUserId}>`,
        embeds: [embed]
    });
}