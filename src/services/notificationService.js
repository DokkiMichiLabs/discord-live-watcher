import { EmbedBuilder } from "discord.js";

export async function sendLiveNotification(client, config, liveData) {
    const channel = await client.channels.fetch(config.discordChannelId);
    if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${config.discordChannelId} is not a text channel.`);
    }

    const embed = new EmbedBuilder()
        .setTitle(`🔴 ${liveData.displayName} is now live on Twitch!`)
        .setDescription(`[Watch now](${liveData.url})\n\n**${liveData.title || "Live now"}**`)
        .addFields(
            { name: "Platform", value: "Twitch", inline: true },
            { name: "Streamer", value: liveData.displayName, inline: true },
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