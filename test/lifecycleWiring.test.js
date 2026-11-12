import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

// Explicit dummy configuration only; no production credentials or real DB connections.
for (const key of ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]) process.env[key] = "test-only";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.NODE_ENV = "production";
process.env.DOTENV_CONFIG_PATH = "test/.env.does-not-exist";
delete process.env.DISCORD_NOTIFICATION_ROLE_ID;
const { getTwitchLiveStatus } = await import("../src/platforms/twitch/twitchAdapter.js");
const { handleStreamStateTransition } = await import("../src/services/streamStateService.js");
const { prisma } = await import("../src/db/prisma.js");

test("Helix current response flows through production Twitch dispatch without retaining remote image URLs", async t => {
    const adapter = axios.defaults.adapter;
    t.after(() => { axios.defaults.adapter = adapter; });
    const requests = [];
    axios.defaults.adapter = async config => {
        requests.push(config.url);
        let data;
        if (config.url === "https://id.twitch.tv/oauth2/token") data = { access_token: "mock-token", expires_in: 3600 };
        else if (config.url === "https://api.twitch.tv/helix/users") data = { data: [{ display_name: "Streamer", login: "streamer" }] };
        else if (config.url === "https://api.twitch.tv/helix/streams") data = { data: [{ id: "current-helix-id", started_at: "2026-11-11T20:00:00Z", title: "This broadcast", thumbnail_url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer-{width}x{height}.jpg" }] };
        else throw new Error("Mock CDN unavailable");
        return { status: 200, headers: {}, data, config };
    };
    const data = await getTwitchLiveStatus("streamer");
    assert.equal(data.streamId, "current-helix-id");
    assert.equal(data.startedAt, "2026-11-11T20:00:00Z");
    assert.equal(data.thumbnailUrl, "https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer-1280x720.jpg");
    const config = { id: "wired-twitch", platform: "twitch", isActive: true, platformUsername: "streamer", discordChannelId: "channel", state: { lastStreamId: "previous-broadcast", lastThumbnailUrl: "https://expired.invalid/old.jpg" } };
    const find = prisma.streamWatchConfig.findUnique;
    const update = prisma.streamWatchState.update;
    t.after(() => { prisma.streamWatchConfig.findUnique = find; prisma.streamWatchState.update = update; });
    prisma.streamWatchConfig.findUnique = async () => structuredClone(config);
    prisma.streamWatchState.update = async ({ data }) => Object.assign(config.state, data);
    const sends = [];
    const client = { channels: { fetch: async () => ({ id: "channel", isTextBased: () => true, send: async payload => { sends.push(payload); return { id: "new-message" }; } }) }, users: { fetch: async () => { throw new Error("No banner"); } } };
    await handleStreamStateTransition(client, config, async () => data);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].embeds[0].data.image, undefined);
    assert.equal(config.state.lastStreamId, "current-helix-id");
    assert.equal(config.state.lastThumbnailUrl, null);
    assert.equal(config.state.lastNotificationMessageId, "new-message");
    assert.equal(requests.filter(url => url.startsWith("https://api.twitch.tv/helix/")).length, 2);
});

test("production TikTok dispatch still sends, deduplicates, and edits offline with original role behavior", async t => {
    const update = prisma.streamWatchState.update;
    const writes = [];
    prisma.streamWatchState.update = async ({ data }) => { writes.push(data); return data; };
    t.after(() => { prisma.streamWatchState.update = update; });
    const config = { id: "wired-tiktok", platform: "tiktok", platformUsername: "creator", discordChannelId: "channel", state: {} };
    const sends = [];
    const edits = [];
    const client = { channels: { fetch: async () => ({ id: "channel", isTextBased: () => true,
        send: async payload => { sends.push(payload); return { id: "tiktok-message" }; },
        messages: { fetch: async () => ({ edit: async payload => edits.push(payload) }) }
    }) }, users: { fetch: async () => { throw new Error("No banner"); } } };
    const data = { found: true, isLive: true, streamId: "room", title: "TikTok title", thumbnailUrl: "https://example.org/tiktok.jpg" };
    await handleStreamStateTransition(client, config, data);
    Object.assign(config.state, ...writes);
    await handleStreamStateTransition(client, config, data);
    await handleStreamStateTransition(client, config, { found: true, isLive: false });
    assert.equal(sends.length, 1);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].content, "<@&1466589257933127703>");
    assert.equal(edits[0].embeds[0].data.image.url, "https://example.org/tiktok.jpg");
    assert.equal(writes.at(-1).isLive, false);
});
