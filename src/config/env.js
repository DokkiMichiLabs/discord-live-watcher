import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export const env = {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordClientId: requireEnv("DISCORD_CLIENT_ID"),
    discordGuildId: requireEnv("DISCORD_GUILD_ID"),
    databaseUrl: requireEnv("DATABASE_URL"),
    twitchClientId: process.env.TWITCH_CLIENT_ID || "",
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    watchIntervalMs: Number(process.env.WATCH_INTERVAL_MS || 60000)
};