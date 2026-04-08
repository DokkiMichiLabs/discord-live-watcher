import { Client, GatewayIntentBits } from "discord.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { handleInteraction } from "./bot/interactionHandler.js";
import { startTikTokWatcher, startTwitchWatcher } from "./services/watcherService.js";
import { startWebhookServer } from "./services/webhookServer.js";
import { prisma } from "./db/prisma.js";

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
    logger.info({ botUser: client.user.tag }, "Discord bot is ready");

    try {
        await prisma.$connect();
        logger.info("Connected to database");
    } catch (error) {
        logger.error({ error }, "Failed to connect to database");
        process.exit(1);
    }

    startWebhookServer(client);
    startTwitchWatcher(client, env.twitchWatchIntervalMs);
    startTikTokWatcher(client);
});

client.on("interactionCreate", async interaction => {
    try {
        await handleInteraction(interaction);
    } catch (error) {
        logger.error({ error }, "Interaction handler failed");

        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: "Something went wrong while processing that command.",
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: "Something went wrong while processing that command.",
                    ephemeral: true
                });
            }
        }
    }
});

client.login(env.discordToken).catch(error => {
    logger.error({ error }, "Discord login failed");
    process.exit(1);
});
