import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function parseNumberEnv(name, fallback) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === "") {
        return fallback;
    }

    const parsedValue = Number(rawValue);

    if (Number.isNaN(parsedValue)) {
        throw new Error(`Environment variable ${name} must be a number.`);
    }

    return parsedValue;
}

function parseBooleanEnv(name, fallback = false) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === "") {
        return fallback;
    }

    return /^(1|true|yes|on)$/i.test(rawValue);
}

const legacyWatchIntervalMs = parseNumberEnv("WATCH_INTERVAL_MS", 60000);

export const env = {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordClientId: requireEnv("DISCORD_CLIENT_ID"),
    discordGuildId: requireEnv("DISCORD_GUILD_ID"),
    databaseUrl: requireEnv("DATABASE_URL"),
    twitchClientId: process.env.TWITCH_CLIENT_ID || "",
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    watchIntervalMs: legacyWatchIntervalMs,
    twitchWatchIntervalMs: parseNumberEnv("TWITCH_WATCH_INTERVAL_MS", legacyWatchIntervalMs),
    tiktokDailyBudget: parseNumberEnv("TIKTOK_DAILY_BUDGET", 700),
    tiktokMinIntervalMinutes: parseNumberEnv("TIKTOK_MIN_INTERVAL_MINUTES", 2),
    tiktokMaxIntervalMinutes: parseNumberEnv("TIKTOK_MAX_INTERVAL_MINUTES", 30),
    tiktokIdleIntervalMs: parseNumberEnv("TIKTOK_IDLE_INTERVAL_MS", 5 * 60 * 1000),
    tiktokRateLimitBackoffMs: parseNumberEnv("TIKTOK_RATE_LIMIT_BACKOFF_MS", 30 * 60 * 1000),
    tiktokPerStreamerDelayMs: parseNumberEnv("TIKTOK_PER_STREAMER_DELAY_MS", 1500),
    tiktokOverlapRetryMs: parseNumberEnv("TIKTOK_OVERLAP_RETRY_MS", 60 * 1000),
    tiktokFailureRetryMs: parseNumberEnv("TIKTOK_FAILURE_RETRY_MS", 5 * 60 * 1000),
    eulerAlertsEnabled: parseBooleanEnv("EULER_ALERTS_ENABLED", false),
    eulerApiKey: process.env.EULER_API_KEY || "",
    eulerAccountId: process.env.EULER_ACCOUNT_ID || "",
    eulerWebhookSecret: process.env.EULER_WEBHOOK_SECRET || "",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    webhookPort: parseNumberEnv("WEBHOOK_PORT", parseNumberEnv("PORT", 3000)),
    eulerWebhookPath: process.env.EULER_WEBHOOK_PATH || "/webhooks/euler/live-alerts",
    tiktokUnknownLiveGraceMs: parseNumberEnv("TIKTOK_UNKNOWN_LIVE_GRACE_MS", 30 * 60 * 1000)
};
