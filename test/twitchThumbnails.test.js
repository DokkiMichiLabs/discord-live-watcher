import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import axios from "axios";
import { Collection, EmbedBuilder, MessagePayload } from "discord.js";
import { fetchTwitchThumbnail, thumbnailName, isBroadcastThumbnail, THUMBNAIL_MAX_BYTES, THUMBNAIL_TIMEOUT_MS } from "../src/platforms/twitch/twitchThumbnail.js";
import { createTwitchStateHandler } from "../src/services/twitchStateService.js";
// Import configured services only after installing dummy process-local settings.
for (const key of ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]) process.env[key] = "test-only";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.DOTENV_CONFIG_PATH = "test/.env.does-not-exist";
delete process.env.DISCORD_NOTIFICATION_ROLE_ID;
const { sendLiveNotification, refreshTwitchNotificationImage, updateLiveNotificationToOffline } = await import("../src/services/notificationService.js");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const live = (streamId = "broadcast-a") => ({ found: true, isLive: true, streamId, title: "Current title", displayName: "Streamer", url: "https://twitch.tv/streamer", thumbnailUrl: "https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer-1280x720.jpg" });
const offline = { found: true, isLive: false };
const image = (id = "broadcast-a", hash = "a") => ({ buffer: png, name: thumbnailName(id, hash.repeat(64), "png") });

function discordMock() {
    const sends = [];
    const edits = [];
    const messages = new Map();
    const fetches = [];
    const cached = new Map();
    let failure = null;
    let afterApplyFailure = null;
    function apply(message, payload) {
        for (const keep of payload.attachments || []) {
            if (!message.attachments.has(keep.id)) throw Object.assign(new Error("Unknown retained attachment"), { status: 400 });
        }
        if (payload.embeds) message.embeds = payload.embeds.map(embed => EmbedBuilder.from(embed).toJSON());
        if (payload.attachments) message.attachments = message.attachments.filter(attachment => payload.attachments.some(keep => keep.id === attachment.id));
        for (const file of payload.files || []) {
            const id = `attachment-${edits.length}-${message.attachments.size}`;
            message.attachments.set(id, { id, name: file.name, url: `https://cdn.discordapp.com/attachments/channel/${id}/${file.name}?ex=expires` });
        }
    }
    const channel = {
        id: "channel", isTextBased: () => true,
        messages: { fetch: async options => {
            fetches.push(options);
            const id = typeof options === "string" ? options : options.message;
            if (!messages.has(id)) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
            if (!options.force && cached.has(id)) return cached.get(id);
            return messages.get(id);
        } },
        send: async payload => {
            sends.push(payload);
            if (failure) { const error = failure; failure = null; throw error; }
            const message = {
                id: `message-${sends.length}`, attachments: new Collection(), embeds: [],
                edit: async payload => {
                    edits.push(payload);
                    if (failure) { const error = failure; failure = null; throw error; }
                    apply(message, payload);
                    if (afterApplyFailure) { const error = afterApplyFailure; afterApplyFailure = null; throw error; }
                    return message;
                }
            };
            apply(message, payload);
            messages.set(message.id, message);
            return message;
        }
    };
    return {
        client: { channels: { fetch: async () => channel }, users: { fetch: async () => ({ displayAvatarURL: () => "https://example.org/avatar.png", bannerURL: () => "https://example.org/banner.png" }) } },
        sends, edits, messages, fetches,
        failNext: error => { failure = error; },
        failAfterApply: error => { afterApplyFailure = error; },
        cacheMessages: () => {
            for (const [id, message] of messages) cached.set(id, { ...message, embeds: structuredClone(message.embeds), attachments: new Collection(message.attachments) });
        }
    };
}

function lifecycle() {
    const discord = discordMock();
    let clock = 1000000;
    let currentImage = image();
    let downloads = 0;
    const config = { id: "config", isActive: true, platform: "twitch", platformUsername: "streamer", discordUserId: "user", discordChannelId: "channel", state: {} };
    const dependencies = {
        getConfig: async () => structuredClone(config),
        updateState: async (id, data) => Object.assign(config.state, data),
        sendLive: sendLiveNotification, refreshImage: refreshTwitchNotificationImage, setOffline: updateLiveNotificationToOffline,
        fetchImage: async () => { downloads++; return currentImage; }, intervalMs: 300000,
        logger: { warn() {} }, now: () => clock
    };
    let handler = createTwitchStateHandler(dependencies);
    return {
        ...discord, config, dependencies,
        tick: data => handler(discord.client, config, data),
        advance: (ms = 300000) => { clock += ms; },
        setImage: value => { currentImage = value; },
        downloads: () => downloads,
        restart: () => { handler = createTwitchStateHandler(dependencies); }
    };
}

test("current broadcast uploads a stream-specific attachment and preserves initial role mention", async () => {
    const h = lifecycle();
    await h.tick(live());
    assert.equal(h.sends.length, 1);
    assert.equal(h.sends[0].content, "<@&1466589257933127703>");
    assert.equal(h.sends[0].embeds[0].data.image.url, `attachment://${image().name}`);
    assert.equal(h.config.state.lastStreamId, "broadcast-a");
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image().name}`);
    assert.ok(isBroadcastThumbnail(image().name, "broadcast-a"));
    assert.ok(!isBroadcastThumbnail(image().name, "broadcast-b"));
});

test("active refresh obeys interval, preserves embed information, and never sends or mentions", async () => {
    const h = lifecycle();
    await h.tick(live());
    const original = structuredClone(h.sends[0].embeds[0].toJSON());
    h.setImage(image("broadcast-a", "b"));
    h.advance(299999);
    await h.tick(live());
    assert.equal(h.downloads(), 1);
    assert.equal(h.edits.length, 0);
    h.advance(1);
    await h.tick(live());
    assert.equal(h.downloads(), 2);
    assert.equal(h.sends.length, 1);
    assert.equal(h.edits.length, 1);
    const edit = h.edits[0];
    assert.equal(edit.content, undefined);
    assert.deepEqual(edit.allowedMentions, { parse: [] });
    const changed = edit.embeds[0].toJSON();
    delete original.image;
    delete changed.image;
    assert.deepEqual(changed, original);
    assert.equal(h.messages.get(h.config.state.lastNotificationMessageId).attachments.size, 1);
});

test("unchanged bytes do not edit even after a restart", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.advance();
    await h.tick(live());
    h.restart();
    await h.tick(live());
    assert.equal(h.downloads(), 3);
    assert.equal(h.edits.length, 0);
    assert.equal(h.sends.length, 1);
});

test("offline edit retains last valid attachment even with stale database thumbnail metadata", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.advance();
    h.setImage(image("broadcast-a", "b"));
    await h.tick(live());
    h.config.state.lastThumbnailUrl = "https://expired.twitch.invalid/old.jpg";
    await h.tick(offline);
    const edit = h.edits.at(-1);
    assert.equal(edit.embeds[0].data.image.url, `attachment://${image("broadcast-a", "b").name}`);
    assert.equal(edit.attachments.length, 1);
    assert.equal(edit.files, undefined);
    assert.equal(h.config.state.isLive, false);
    assert.equal(h.messages.get(h.config.state.lastNotificationMessageId).attachments.size, 1);
});

test("new ID while still live sends a new broadcast and cannot inherit old thumbnail", async () => {
    const h = lifecycle();
    await h.tick(live());
    const previousId = h.config.state.lastNotificationMessageId;
    h.setImage(null);
    await h.tick(live("broadcast-b"));
    assert.equal(h.sends.length, 2);
    assert.equal(h.config.state.lastStreamId, "broadcast-b");
    assert.equal(h.config.state.lastThumbnailUrl, null);
    assert.equal(h.sends[1].files, undefined);
    assert.equal(h.sends[1].embeds[0].data.image.url, "https://example.org/banner.png");
    const previous = h.messages.get(previousId);
    assert.equal(previous.embeds[0].fields.find(field => field.name === "Status").value, "Offline");
    assert.equal(previous.embeds[0].image.url, `attachment://${image().name}`);
    assert.equal(previous.attachments.size, 1);
});

test("failed replacement retains old references, then recovers at interval without a new announcement", async () => {
    const h = lifecycle();
    await h.tick(live());
    const id = h.config.state.lastNotificationMessageId;
    h.setImage(image("broadcast-a", "b"));
    h.advance();
    h.failNext(Object.assign(new Error("Upload rejected"), { status: 413 }));
    await h.tick(live());
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image().name}`);
    assert.equal(h.messages.get(id).embeds[0].image.url, h.config.state.lastThumbnailUrl);
    assert.equal(h.messages.get(id).attachments.first().name, image().name);
    h.advance();
    await h.tick(live());
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image("broadcast-a", "b").name}`);
    assert.equal(h.messages.get(id).embeds[0].image.url, h.config.state.lastThumbnailUrl);
    assert.equal(h.messages.get(id).attachments.first().name, image("broadcast-a", "b").name);
    assert.equal(h.sends.length, 1);
});

test("replacement payload removes old thumbnail, retains unrelated attachment, and references new upload filename", async () => {
    const h = lifecycle();
    await h.tick(live());
    const message = h.messages.get(h.config.state.lastNotificationMessageId);
    const oldId = message.attachments.first().id;
    message.attachments.set("unrelated", { id: "unrelated", name: "notes.txt" });
    h.setImage(image("broadcast-a", "b"));
    h.advance();
    await h.tick(live());
    const payload = MessagePayload.create({ client: { options: {} } }, h.edits.at(-1));
    payload.resolveBody();
    await payload.resolveFiles();
    assert.deepEqual(payload.body.attachments.map(attachment => attachment.id), ["unrelated", "0"]);
    assert.equal(payload.body.embeds[0].image.url, `attachment://${payload.files[0].name}`);
    assert.equal(message.attachments.has(oldId), false);
    assert.equal(message.attachments.size, 2);
});

test("restart reconciles committed edit with failed database write even if next CDN download fails", async () => {
    const h = lifecycle();
    await h.tick(live());
    const updateState = h.dependencies.updateState;
    h.dependencies.updateState = async () => { throw new Error("DB unavailable"); };
    h.setImage(image("broadcast-a", "b"));
    h.advance();
    h.restart();
    await assert.rejects(h.tick(live()), /DB unavailable/);
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image().name}`);
    h.dependencies.updateState = updateState;
    h.restart();
    h.setImage(null);
    const edits = h.edits.length;
    await h.tick(live());
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image("broadcast-a", "b").name}`);
    assert.equal(h.edits.length, edits);
    assert.equal(h.sends.length, 1);
});

test("offline reference reconciliation retries after a database failure without requiring restart", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.failNext(new Error("Offline edit initially failed"));
    await h.tick(offline);
    assert.equal(h.config.state.isLive, false);
    h.config.state.lastThumbnailUrl = "attachment://stale-name.png";
    const updateState = h.dependencies.updateState;
    let writes = 0;
    const writer = async (id, data) => { if (writes++ === 0) throw new Error("DB unavailable"); return updateState(id, data); };
    h.dependencies.updateState = writer;
    h.restart();
    await assert.rejects(h.tick(offline), /DB unavailable/);
    h.advance();
    await h.tick(offline);
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image().name}`);
});

test("offline after ambiguous committed replacement bypasses stale Discord cache and reconciles saved reference", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.cacheMessages();
    h.setImage(image("broadcast-a", "b"));
    h.advance();
    h.failAfterApply(new Error("Response lost after Discord commit"));
    await h.tick(live());
    h.restart();
    await h.tick(offline);
    const message = h.messages.get(h.config.state.lastNotificationMessageId);
    assert.equal(message.embeds[0].fields.find(field => field.name === "Status").value, "Offline");
    assert.equal(message.embeds[0].image.url, `attachment://${image("broadcast-a", "b").name}`);
    assert.equal(h.config.state.lastThumbnailUrl, message.embeds[0].image.url);
    assert.ok(h.fetches.every(options => options.force === true));
    assert.equal(message.attachments.size, 1);
});

test("rollover edit failure retains previous message pointer for retry across restart", async () => {
    const h = lifecycle();
    await h.tick(live());
    const previousId = h.config.state.lastNotificationMessageId;
    h.setImage(image("broadcast-b", "b"));
    h.failNext(new Error("Offline edit rejected"));
    await assert.rejects(h.tick(live("broadcast-b")), /Offline edit rejected/);
    assert.equal(h.config.state.lastNotificationMessageId, previousId);
    assert.equal(h.config.state.lastStreamId, "broadcast-a");
    assert.equal(h.sends.length, 1);
    h.restart();
    await h.tick(live("broadcast-b"));
    assert.equal(h.messages.get(previousId).embeds[0].fields.find(field => field.name === "Status").value, "Offline");
    assert.equal(h.config.state.lastStreamId, "broadcast-b");
    assert.equal(h.sends.length, 2);
});

test("deleted previous message does not permanently block stream-ID rollover", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.messages.delete(h.config.state.lastNotificationMessageId);
    h.setImage(image("broadcast-b", "b"));
    await h.tick(live("broadcast-b"));
    assert.equal(h.config.state.lastStreamId, "broadcast-b");
    assert.equal(h.sends.length, 2);
    assert.equal(h.messages.size, 1);
});

test("restart recognizes Discord CDN embed URL and retains filename attachment offline with failed CDN download", async () => {
    const h = lifecycle();
    await h.tick(live());
    const message = h.messages.get(h.config.state.lastNotificationMessageId);
    message.embeds[0].image.url = message.attachments.first().url;
    h.config.state.lastThumbnailUrl = "attachment://stale-name.png";
    h.restart();
    await h.tick(live());
    assert.equal(h.edits.length, 0);
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image().name}`);
    h.setImage(null);
    h.restart();
    await h.tick(offline);
    assert.equal(message.embeds[0].image.url, `attachment://${image().name}`);
    assert.equal(message.attachments.first().name, image().name);
    assert.equal(h.sends.length, 1);
});

test("offline observation queued during Discord replacement ends offline for both successful and rejected edits", async t => {
    for (const rejectEdit of [false, true]) {
        await t.test(rejectEdit ? "rejected replacement" : "successful replacement", async () => {
            const h = lifecycle();
            await h.tick(live());
            h.advance();
            h.setImage(image("broadcast-a", "b"));
            const message = h.messages.get(h.config.state.lastNotificationMessageId);
            const edit = message.edit;
            let release;
            let entered;
            const started = new Promise(resolve => { entered = resolve; });
            message.edit = async payload => {
                message.edit = edit;
                entered();
                await new Promise(resolve => { release = resolve; });
                if (rejectEdit) throw new Error("Replacement rejected");
                return edit(payload);
            };
            const refresh = h.tick(async () => live());
            await started;
            let observed = false;
            const ending = h.tick(async () => { observed = true; return offline; });
            assert.equal(observed, false);
            release();
            await Promise.all([refresh, ending]);
            assert.equal(h.config.state.isLive, false);
            assert.equal(message.embeds[0].fields.find(field => field.name === "Status").value, "Offline");
            const expected = rejectEdit ? image() : image("broadcast-a", "b");
            assert.equal(message.embeds[0].image.url, `attachment://${expected.name}`);
            assert.equal(h.config.state.lastThumbnailUrl, message.embeds[0].image.url);
            assert.equal(message.attachments.size, 1);
            assert.equal(h.sends.length, 1);
        });
    }
});

test("failed downloads are throttled, keep valid image, and do not block offline", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.setImage(null);
    h.advance();
    await h.tick(live());
    await h.tick(live());
    assert.equal(h.downloads(), 2);
    assert.equal(h.edits.length, 0);
    await h.tick(offline);
    assert.equal(h.edits[0].embeds[0].data.image.url, `attachment://${image().name}`);
});

test("refresh and offline Discord failures leave monitoring active and retry at interval", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.setImage(image("broadcast-a", "b"));
    h.advance();
    h.failNext(new Error("Discord unavailable"));
    await h.tick(live());
    assert.equal(h.config.state.lastThumbnailUrl, `attachment://${image().name}`);
    h.failNext(new Error("Discord unavailable"));
    await h.tick(offline);
    assert.equal(h.config.state.isLive, false);
    const edits = h.edits.length;
    await h.tick(offline);
    assert.equal(h.edits.length, edits);
    h.advance();
    await h.tick(offline);
    assert.equal(h.edits.length, edits + 1);
});

test("concurrent refresh and offline check serialize observation, image upload, and final state", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.advance();
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    h.dependencies.fetchImage = async () => { entered(); return new Promise(resolve => { release = () => resolve(image("broadcast-a", "b")); }); };
    h.restart();
    const refreshing = h.tick(async () => live());
    await started;
    let checkedOffline = false;
    const ending = h.tick(async () => { checkedOffline = true; return offline; });
    assert.equal(checkedOffline, false);
    release();
    await Promise.all([refreshing, ending]);
    assert.equal(h.config.state.isLive, false);
    assert.equal(h.sends.length, 1);
    assert.equal(h.edits.length, 2);
    assert.equal(h.edits[1].embeds[0].data.fields.find(field => field.name === "Status").value, "Offline");
    assert.equal(h.edits[1].embeds[0].data.image.url, `attachment://${image("broadcast-a", "b").name}`);
});

test("watch reset during download cannot attach old broadcast to reassigned account", async () => {
    const h = lifecycle();
    h.dependencies.fetchImage = async () => { h.config.platformUsername = "new-streamer"; h.config.state = {}; return image(); };
    h.restart();
    await h.tick(live());
    assert.equal(h.sends.length, 0);
    assert.deepEqual(h.config.state, {});
});

test("restart with legacy remote URL never trusts it offline or inherits it in a new broadcast", async () => {
    const h = lifecycle();
    await h.tick(live());
    h.messages.get(h.config.state.lastNotificationMessageId).attachments.clear();
    h.config.state.lastThumbnailUrl = live().thumbnailUrl;
    h.restart();
    await h.tick(offline);
    assert.equal(h.edits[0].embeds[0].data.image.url, "https://example.org/banner.png");
    h.setImage(null);
    await h.tick(live("broadcast-b"));
    assert.equal(h.config.state.lastThumbnailUrl, null);
});

test("same ID after offline is deduplicated", async () => {
    const h = lifecycle();
    await h.tick(live());
    await h.tick(offline);
    await h.tick(live());
    assert.equal(h.sends.length, 1);
    assert.equal(h.config.state.isLive, true);
    assert.equal(h.edits.at(-1).embeds[0].data.fields.find(field => field.name === "Status").value, "Live");
});

test("rejected same-broadcast live restoration retries without a new image or announcement", async () => {
    const h = lifecycle();
    await h.tick(live());
    await h.tick(offline);
    const message = h.messages.get(h.config.state.lastNotificationMessageId);
    h.failNext(Object.assign(new Error("Live restoration rejected"), { status: 400 }));
    await h.tick(live());
    assert.equal(h.config.state.isLive, true);
    assert.equal(message.embeds[0].fields.find(field => field.name === "Status").value, "Offline");
    h.setImage(null);
    h.advance();
    await h.tick(live());
    assert.equal(message.embeds[0].fields.find(field => field.name === "Status").value, "Live");
    assert.equal(message.embeds[0].image.url, `attachment://${image().name}`);
    assert.equal(message.attachments.size, 1);
    assert.equal(h.sends.length, 1);
    assert.equal(h.edits.at(-1).content, undefined);
    assert.deepEqual(h.edits.at(-1).allowedMentions, { parse: [] });
});

test("definitive Discord upload rejection sends fallback; ambiguous error is not retried", async () => {
    const h = lifecycle();
    h.failNext(Object.assign(new Error("Attachment rejected"), { status: 413 }));
    await h.tick(live());
    assert.equal(h.sends.length, 2);
    assert.equal(h.messages.size, 1);
    assert.equal(h.config.state.lastThumbnailUrl, null);
    const second = lifecycle();
    second.failNext(new Error("Connection lost"));
    await assert.rejects(second.tick(live()), /Connection lost/);
    assert.equal(second.sends.length, 1);
});

test("TikTok retains remote images, role content, and offline fallback", async () => {
    const h = lifecycle();
    const config = { ...h.config, platform: "tiktok" };
    const notification = await sendLiveNotification(h.client, config, { ...live(), thumbnailUrl: "https://example.org/tiktok.jpg" });
    assert.equal(h.sends[0].embeds[0].data.image.url, "https://example.org/tiktok.jpg");
    assert.equal(h.sends[0].files, undefined);
    await updateLiveNotificationToOffline(h.client, config, { lastNotificationMessageId: notification.messageId, lastNotificationChannelId: notification.channelId, lastThumbnailUrl: "https://example.org/tiktok.jpg" });
    assert.equal(h.edits[0].embeds[0].data.image.url, "https://example.org/tiktok.jpg");
    assert.equal(h.edits[0].content, h.sends[0].content);
    assert.equal(h.edits[0].allowedMentions, undefined);
});

test("Discord.js serializes retained IDs together with replacement file", async () => {
    const payload = MessagePayload.create({ client: { options: {} } }, {
        attachments: [{ id: "123" }], files: [{ attachment: png, name: "test.png" }], allowedMentions: { parse: [] }
    });
    payload.resolveBody();
    await payload.resolveFiles();
    assert.deepEqual(payload.body.attachments.map(value => value.id), ["123", "0"]);
    assert.equal(payload.files[0].name, "test.png");
});

test("HTTP validation uses current Helix URL, broadcast key, bounded deadline, and content fingerprint", async () => {
    let request;
    const fetch = async (url, options) => {
        request = { url: new URL(url), options };
        return { status: 200, headers: { "content-type": "image/png" }, data: Readable.from([png]) };
    };
    const result = await fetchTwitchThumbnail(live(), { get: fetch, now: () => 123 });
    assert.equal(request.url.pathname, new URL(live().thumbnailUrl).pathname);
    assert.equal(request.url.searchParams.get("dlw_stream"), "broadcast-a");
    assert.equal(request.url.searchParams.get("dlw_refresh"), "123");
    assert.equal(request.options.timeout, THUMBNAIL_TIMEOUT_MS);
    assert.equal(request.options.maxRedirects, 0);
    assert.ok(isBroadcastThumbnail(result.name, "broadcast-a"));
    assert.deepEqual(result.buffer, png);
    const again = await fetchTwitchThumbnail(live(), { get: fetch, now: () => 456 });
    assert.equal(result.name, again.name);
});

test("missing, unsafe, expired, invalid, oversized, and failed HTTP images return no image", async t => {
    for (const [name, data, response] of [
        ["missing URL", { ...live(), thumbnailUrl: null }, null],
        ["missing stream ID", { ...live(), streamId: null }, null],
        ["unsafe host", { ...live(), thumbnailUrl: "https://localhost/private" }, null],
        ["expired", live(), { status: 404 }],
        ["CDN object predates broadcast", { ...live(), startedAt: "2026-11-11T20:00:00Z" }, { modified: "Tue, 10 Nov 2026 20:00:00 GMT" }],
        ["redirect", live(), { status: 302 }],
        ["wrong MIME", live(), { type: "text/html" }],
        ["HTML with image MIME", live(), { bytes: Buffer.from("<html>not an image</html>") }],
        ["truncated", live(), { bytes: png.subarray(0, 30) }],
        ["oversized header", live(), { length: THUMBNAIL_MAX_BYTES + 1 }],
        ["oversized stream", live(), { bytes: Buffer.alloc(THUMBNAIL_MAX_BYTES + 1) }],
        ["timeout", live(), { error: new Error("ETIMEDOUT") }]
    ]) {
        await t.test(name, async () => {
            const get = async () => {
                assert.ok(response, "missing URL/ID and unsafe hosts must not make HTTP requests");
                if (response.error) throw response.error;
                return { status: response.status || 200, headers: { "content-type": response.type || "image/png", "content-length": response.length, "last-modified": response.modified }, data: Readable.from([response.bytes || png]) };
            };
            assert.equal(await fetchTwitchThumbnail(data, { get }), null);
        });
    }
});

test("real Axios transport enforces total deadline and byte limit against local HTTP stand-in", async t => {
    const server = createServer((request, response) => {
        response.writeHead(200, { "content-type": "image/png" });
        if (request.url === "/slow") { response.write(png.subarray(0, 8)); return; }
        if (request.url === "/large") { response.end(Buffer.alloc(THUMBNAIL_MAX_BYTES + 1)); return; }
        response.end(png);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const route = path => (url, options) => axios.get(`${base}${path}`, { ...options, proxy: false });
    assert.ok(await fetchTwitchThumbnail(live(), { get: route("/ok") }));
    assert.equal(await fetchTwitchThumbnail(live(), { get: route("/large") }), null);
    const start = Date.now();
    assert.equal(await fetchTwitchThumbnail(live(), { get: route("/slow") }), null);
    assert.ok(Date.now() - start < THUMBNAIL_TIMEOUT_MS + 2000);
});
