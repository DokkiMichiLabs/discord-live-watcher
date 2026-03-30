import {
    SlashCommandBuilder,
    PermissionFlagsBits
} from "discord.js";
import { removeStreamConfig } from "../../repositories/streamWatchRepository.js";

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

    try {
        await removeStreamConfig({
            guildId: interaction.guildId,
            discordUserId: discordUser.id,
            platform
        });

        await interaction.reply({
            content: `Removed ${platform} stream watch for <@${discordUser.id}>.`,
            ephemeral: true
        });
    } catch {
        await interaction.reply({
            content: `No ${platform} stream watch was found for <@${discordUser.id}>.`,
            ephemeral: true
        });
    }
}