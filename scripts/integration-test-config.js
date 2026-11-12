import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "TEST_DISCORD_CHANNEL_ID", "TEST_DISCORD_USER_ID", "TEST_TWITCH_USERNAME", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "DATABASE_URL"];
const settings = ["DISCORD_NOTIFICATION_ROLE_ID", "TIKTOK_WATCHER_ENABLED", "WEBHOOK_SERVER_ENABLED", "EULER_ALERTS_ENABLED", "EULER_API_KEY", "EULER_ACCOUNT_ID", "EULER_WEBHOOK_SECRET", "PUBLIC_BASE_URL", "TWITCH_WATCH_INTERVAL_MS", "TWITCH_THUMBNAIL_REFRESH_MS", "NODE_ENV"];

export function validateIntegrationConfig(config) {
    for (const key of Object.keys(config)) {
        if (![...required, ...settings].includes(key)) throw new Error(`Unsupported isolated test setting: ${key}`);
    }
    for (const key of required) {
        if (!config[key]?.trim() || /[<>]/.test(config[key])) throw new Error(`Replace the test placeholder for ${key}`);
    }
    for (const key of ["DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "TEST_DISCORD_CHANNEL_ID", "TEST_DISCORD_USER_ID"]) {
        if (!/^\d{1,20}$/.test(config[key])) throw new Error(`${key} must be a Discord ID`);
    }
    for (const key of ["TIKTOK_WATCHER_ENABLED", "WEBHOOK_SERVER_ENABLED", "EULER_ALERTS_ENABLED"]) {
        if (config[key] !== "false") throw new Error(`${key} must explicitly be false for isolation`);
    }
    for (const key of ["DISCORD_NOTIFICATION_ROLE_ID", "EULER_API_KEY", "EULER_ACCOUNT_ID", "EULER_WEBHOOK_SECRET", "PUBLIC_BASE_URL"]) {
        if (config[key] !== "") throw new Error(`${key} must explicitly be blank for isolation`);
    }
    if (!/^[a-z0-9_]{1,100}$/.test(config.TEST_TWITCH_USERNAME)) throw new Error("Use one lowercase Twitch login, without a URL or list");
    for (const key of ["TWITCH_WATCH_INTERVAL_MS", "TWITCH_THUMBNAIL_REFRESH_MS"]) {
        if (!Number.isSafeInteger(Number(config[key])) || Number(config[key]) < 60000) throw new Error(`${key} must be an integer of at least 60000`);
    }
    let database;
    try { database = new URL(config.DATABASE_URL); } catch { throw new Error("Invalid isolated DATABASE_URL"); }
    if (!["postgres:", "postgresql:"].includes(database.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || database.port !== "5433" ||
        database.pathname !== "/discord_live_watcher_integration" ||
        decodeURIComponent(database.username) !== "discord_live_watcher_integration" || !database.password ||
        [...database.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) {
        throw new Error("Integration database must use the dedicated local role/database on loopback port 5433 with only schema=public");
    }
    return config;
}

export function loadIntegrationConfig(path = ".env.test") {
    return validateIntegrationConfig(dotenv.parse(readFileSync(resolve(path))));
}

export function integrationChildEnvironment(config, path, inherited = process.env) {
    // Preserve OS runtime essentials only: no inherited app secrets, proxies, NODE_OPTIONS,
    // Prisma overrides, or dotenv paths can route this child to another environment.
    const child = {};
    const osKeys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "userprofile", "appdata", "localappdata", "home", "lang"]);
    for (const [key, value] of Object.entries(inherited)) {
        if (osKeys.has(key.toLowerCase())) child[key] = value;
    }
    return { ...child, ...config, DOTENV_CONFIG_PATH: resolve(path) };
}

export function integrationWatch(config) {
    return {
        guildId: config.DISCORD_GUILD_ID,
        discordUserId: config.TEST_DISCORD_USER_ID,
        discordChannelId: config.TEST_DISCORD_CHANNEL_ID,
        platform: "twitch",
        platformUsername: config.TEST_TWITCH_USERNAME,
        isActive: true
    };
}

export function assertSingleIntegrationWatch(rows, expected) {
    if (rows.length !== 1 || Object.entries(expected).some(([key, value]) => rows[0][key] !== value) || !rows[0].state ||
        rows[0].eulerAlertId || rows[0].eulerTargetId ||
        (rows[0].state.lastNotificationChannelId && rows[0].state.lastNotificationChannelId !== expected.discordChannelId)) {
        throw new Error("Test database must contain exactly one matching active Twitch watch with its own state; no other watches are allowed");
    }
}
