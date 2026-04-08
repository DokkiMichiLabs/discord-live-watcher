import {
    SlashCommandBuilder,
    PermissionFlagsBits
} from "discord.js";
import { upsertStreamConfig } from "../../repositories/streamWatchRepository.js";
import { ensureTikTokAlertSubscription } from "../../platforms/tiktok/eulerAlertsService.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export const data = new SlashCommandBuilder()
    .setName("set-stream")
    .setDescription("Register or update a stream watch for a Discord user.")
    .addUserOption(option =>
        option
            .setName("discord-user")
            .setDescription("Discord user tied to this watch config.")
            .setRequired(true)
    )
    .addChannelOption(option =>
        option
            .setName("channel")
            .setDescription("Discord channel where live alerts should be posted.")
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
    .addStringOption(option =>
        option
            .setName("platform-username")
            .setDescription("Platform username/handle to watch.")
            .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const discordUser = interaction.options.getUser("discord-user", true);
    const channel = interaction.options.getChannel("channel", true);
    const platform = interaction.options.getString("platform", true);
    let platformUsername = interaction.options.getString("platform-username", true);

    if (platform === "tiktok") {
        platformUsername = platformUsername.replace(/^@/, "").trim().toLowerCase();
    }

    if (platform === "twitch") {
        platformUsername = platformUsername.trim().toLowerCase();
    }

    let config = await upsertStreamConfig({
        guildId: interaction.guildId,
        discordUserId: discordUser.id,
        discordChannelId: channel.id,
        platform,
        platformUsername
    });

    let eulerStatusLine = "";

    if (platform === "tiktok") {
        if (env.eulerAlertsEnabled) {
            try {
                const syncResult = await ensureTikTokAlertSubscription(config);
                config = syncResult.config || config;
                eulerStatusLine = `\n- Euler alerts: **synced**`;
            } catch (error) {
                logger.error(
                    {
                        error,
                        configId: config.id,
                        platformUsername: config.platformUsername
                    },
                    "Failed to sync TikTok Euler alert subscription"
                );
                eulerStatusLine = `\n- Euler alerts: **not synced**`;
            }
        } else {
            eulerStatusLine = `\n- Euler alerts: **disabled**`;
        }
    }

    await interaction.reply({
        content:
            `Saved stream watch:\n` +
            `- Discord user: <@${config.discordUserId}>\n` +
            `- Channel: <#${config.discordChannelId}>\n` +
            `- Platform: **${config.platform}**\n` +
            `- Username: **${config.platformUsername}**` +
            eulerStatusLine,
        ephemeral: true
    });
}
