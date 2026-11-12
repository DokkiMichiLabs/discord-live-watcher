import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { validateIntegrationConfig, integrationChildEnvironment, integrationWatch, assertSingleIntegrationWatch } from "../scripts/integration-test-config.js";
import { startConfiguredMonitoring } from "../src/services/monitoringStartup.js";

function config() {
    return {
        DISCORD_TOKEN: "dummy-test-token", DISCORD_CLIENT_ID: "111", DISCORD_GUILD_ID: "222",
        TEST_DISCORD_CHANNEL_ID: "333", TEST_DISCORD_USER_ID: "444", TEST_TWITCH_USERNAME: "test_streamer",
        TWITCH_CLIENT_ID: "dummy-test-client", TWITCH_CLIENT_SECRET: "dummy-test-secret",
        DATABASE_URL: "postgresql://discord_live_watcher_integration:dummy@127.0.0.1:5433/discord_live_watcher_integration?schema=public",
        DISCORD_NOTIFICATION_ROLE_ID: "", TIKTOK_WATCHER_ENABLED: "false", WEBHOOK_SERVER_ENABLED: "false", EULER_ALERTS_ENABLED: "false",
        EULER_API_KEY: "", EULER_ACCOUNT_ID: "", EULER_WEBHOOK_SECRET: "", PUBLIC_BASE_URL: "",
        TWITCH_WATCH_INTERVAL_MS: "60000", TWITCH_THUMBNAIL_REFRESH_MS: "300000", NODE_ENV: "production"
    };
}

test("isolated config accepts only dedicated local database, empty mentions, and disabled shared services", () => {
    assert.doesNotThrow(() => validateIntegrationConfig(config()));
    for (const change of [
        { DATABASE_URL: "postgresql://user:dummy@remote.invalid:5433/discord_live_watcher_integration" },
        { DATABASE_URL: config().DATABASE_URL.replace(":5433/", ":5432/") },
        { DATABASE_URL: config().DATABASE_URL.replace("/discord_live_watcher_integration?", "/other_database?") },
        { DATABASE_URL: config().DATABASE_URL.replace("discord_live_watcher_integration:dummy", "postgres:dummy") },
        { DATABASE_URL: config().DATABASE_URL + "&host=remote.invalid" },
        { DISCORD_TOKEN: "<TEST_BOT_TOKEN>" }, { TEST_TWITCH_USERNAME: "one,two" },
        { TIKTOK_WATCHER_ENABLED: "true" }, { WEBHOOK_SERVER_ENABLED: "true" }, { EULER_ALERTS_ENABLED: "true" },
        { DISCORD_NOTIFICATION_ROLE_ID: "123" }, { EULER_API_KEY: "dummy-shared-key" },
        { NODE_OPTIONS: "--import=unwanted.js" }, { TWITCH_THUMBNAIL_REFRESH_MS: "0" }
    ]) assert.throws(() => validateIntegrationConfig({ ...config(), ...change }));
    const missing = config();
    delete missing.DISCORD_NOTIFICATION_ROLE_ID;
    assert.throws(() => validateIntegrationConfig(missing), /explicitly be blank/);
});

test("launcher strips inherited app settings, dotenv path, proxy and node injection", () => {
    const child = integrationChildEnvironment(config(), ".env.test", {
        PATH: "dummy-path", SystemRoot: "dummy-system", DISCORD_TOKEN: "inherited-secret",
        DATABASE_URL: "inherited-db", DOTENV_CONFIG_PATH: ".env", NODE_OPTIONS: "--import=bad.js",
        HTTPS_PROXY: "http://shared.invalid", EULER_API_KEY: "inherited-key", PORT: "3000"
    });
    assert.equal(child.PATH, "dummy-path");
    assert.equal(child.DISCORD_TOKEN, "dummy-test-token");
    assert.equal(child.DATABASE_URL, config().DATABASE_URL);
    assert.equal(child.DOTENV_CONFIG_PATH, resolve(".env.test"));
    for (const key of ["NODE_OPTIONS", "HTTPS_PROXY", "PORT"]) assert.equal(child[key], undefined);
    assert.equal(child.EULER_API_KEY, "");
});

test("single-watch preflight rejects other streamers, destinations, TikTok, inactive and imported rows", () => {
    const expected = integrationWatch(config());
    const row = { ...expected, state: { isLive: false } };
    assert.doesNotThrow(() => assertSingleIntegrationWatch([row], expected));
    for (const rows of [[], [row, row], [{ ...row, platform: "tiktok" }], [{ ...row, guildId: "999" }],
        [{ ...row, discordChannelId: "999" }], [{ ...row, platformUsername: "other_streamer" }],
        [{ ...row, isActive: false }], [{ ...row, state: null }],
        [{ ...row, eulerAlertId: "shared-alert" }], [{ ...row, state: { lastNotificationChannelId: "999" } }]]) {
        assert.throws(() => assertSingleIntegrationWatch(rows, expected));
    }
});

test("startup activates only Twitch with test settings, while production defaults start all services", () => {
    const calls = [];
    const services = {
        startWebhookServer: () => calls.push("webhook"),
        startTwitchWatcher: (client, interval) => calls.push(`twitch:${interval}`),
        startTikTokWatcher: () => calls.push("tiktok")
    };
    startConfiguredMonitoring({}, { webhookServerEnabled: false, tiktokWatcherEnabled: false, twitchWatchIntervalMs: 60000 }, services);
    assert.deepEqual(calls, ["twitch:60000"]);
    calls.length = 0;
    startConfiguredMonitoring({}, { webhookServerEnabled: true, tiktokWatcherEnabled: true, twitchWatchIntervalMs: 60000 }, services);
    assert.deepEqual(calls, ["webhook", "twitch:60000", "tiktok"]);
});

test("production config defaults remain unchanged and blank test role suppresses mentions on sends and edits", () => {
    const defaults = integrationChildEnvironment(config(), "test/.env.does-not-exist");
    for (const key of ["DISCORD_NOTIFICATION_ROLE_ID", "TIKTOK_WATCHER_ENABLED", "WEBHOOK_SERVER_ENABLED"]) delete defaults[key];
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'const {env}=await import("./src/config/env.js"); console.log(JSON.stringify([env.discordNotificationRoleId,env.tiktokWatcherEnabled,env.webhookServerEnabled]));'], { env: defaults, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), ["1466589257933127703", true, true]);
    const script = `
        const {sendLiveNotification,updateLiveNotificationToOffline}=await import('./src/services/notificationService.js');
        const payloads=[];
        const channel={id:'333',isTextBased:()=>true,send:async p=>{payloads.push(p);return {id:'555'};},messages:{fetch:async()=>({attachments:{find:()=>null,values:()=>[]},edit:async p=>payloads.push(p)})}};
        const client={channels:{fetch:async()=>channel},users:{fetch:async()=>{throw Error('no visuals');}}};
        const cfg={platform:'twitch',discordChannelId:'333'};
        await sendLiveNotification(client,cfg,{title:'Test',streamId:'test'});
        await updateLiveNotificationToOffline(client,cfg,{lastNotificationMessageId:'555',lastNotificationChannelId:'333',lastStreamId:'test'});
        let rejectUpload=true;
        channel.send=async p=>{payloads.push(p);if(rejectUpload){rejectUpload=false;throw Object.assign(Error('upload rejected'),{status:413});}return {id:'666'};};
        await sendLiveNotification(client,cfg,{title:'Test',streamId:'test'},{name:'test.png',buffer:Buffer.from('dummy')});
        console.log(JSON.stringify(payloads.map(p=>[p.content,p.allowedMentions])));
    `;
    const mentions = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: integrationChildEnvironment(config(), "test/.env.does-not-exist"), encoding: "utf8" });
    assert.equal(mentions.status, 0, mentions.stderr);
    const lastLine = mentions.stdout.trim().split("\n").at(-1);
    assert.deepEqual(JSON.parse(lastLine), Array.from({ length: 4 }, () => ["", { parse: [] }]));
});

test("check command validates a file without starting app/database and never prints settings or secrets", t => {
    const directory = mkdtempSync(join(tmpdir(), "dlw-isolation-"));
    t.after(() => {
        assert.equal(dirname(directory), resolve(tmpdir()));
        rmSync(directory, { recursive: true, force: true });
    });
    const file = join(directory, ".env.test");
    writeFileSync(file, Object.entries(config()).map(([key, value]) => `${key}=${value}`).join("\n"));
    const result = spawnSync(process.execPath, ["scripts/integration-local.js", "check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No network or database access performed/);
    assert.doesNotMatch(result.stdout + result.stderr, /dummy-test-token|dummy-test-secret|postgresql:\/\//);
    const missing = spawnSync(process.execPath, ["scripts/integration-local.js", "check", join(directory, "missing")], { encoding: "utf8" });
    assert.notEqual(missing.status, 0);
});
