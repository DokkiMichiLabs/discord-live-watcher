import {
    SlashCommandBuilder,
    PermissionFlagsBits
} from "discord.js";
import {
    getStreamConfig,
    removeStreamConfig
} from "../../repositories/streamWatchRepository.js";
import { removeTikTokAlertSubscription } from "../../platforms/tiktok/eulerAlertsService.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export const data = new SlashCommandBuilder()
    .setName("remove-stream")
    .setDescription("Remove a stream watch config.")
    .addUserOption(option =>
        option
            .setName("discord-user")
            .setDescription("Discord user tied to the watch config.")
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName("platform")
            .setDescription("Streaming platform.")
            .setRequired(true)
            .addChoices(
                { name: "Twitch", value: "twitch" },
                { name: "TikTok", value: "tiktok" }
            )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const discordUser = interaction.options.getUser("discord-user", true);
    const platform = interaction.options.getString("platform", true);

    const existingConfig = await getStreamConfig({
        guildId: interaction.guildId,
        discordUserId: discordUser.id,
        platform
    });

    if (!existingConfig) {
        await interaction.reply({
            content: `No ${platform} stream watch was found for <@${discordUser.id}>.`,
            ephemeral: true
        });
        return;
    }

    let cleanupWarning = "";

    if (platform === "tiktok" && env.eulerAlertsEnabled) {
        try {
            await removeTikTokAlertSubscription(existingConfig);
        } catch (error) {
            logger.error(
                {
                    error,
                    configId: existingConfig.id,
                    platformUsername: existingConfig.platformUsername
                },
                "Failed to remove TikTok Euler alert subscription"
            );
            cleanupWarning = "\nWarning: Euler alert cleanup needs manual review.";
        }
    }

    await removeStreamConfig({
        guildId: interaction.guildId,
        discordUserId: discordUser.id,
        platform
    });

    await interaction.reply({
        content: `Removed ${platform} stream watch for <@${discordUser.id}>.${cleanupWarning}`,
        ephemeral: true
    });
}
