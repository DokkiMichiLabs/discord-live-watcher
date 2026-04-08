import { SlashCommandBuilder } from "discord.js";
import { getGuildStreamConfigs } from "../../repositories/streamWatchRepository.js";

export const data = new SlashCommandBuilder()
    .setName("show-streams")
    .setDescription("Show all configured stream watches for this server.");

export async function execute(interaction) {
    const configs = await getGuildStreamConfigs(interaction.guildId);

    if (!configs.length) {
        await interaction.reply({
            content: "There are no configured stream watches yet.",
            ephemeral: true
        });
        return;
    }

    const lines = configs.map(config => {
        return [
            `• <@${config.discordUserId}>`,
            `platform: **${config.platform}**`,
            `username: **${config.platformUsername}**`,
            `channel: <#${config.discordChannelId}>`,
            `live: **${config.state?.isLive ? "yes" : "no"}**`,
            ...(config.platform === "tiktok" ? [`alerts: **${config.eulerAlertId ? "webhook" : "polling"}**`] : [])
        ].join(" | ");
    });

    await interaction.reply({
        content: lines.join("\n"),
        ephemeral: true
    });
}