import axios from "axios";
import { createHash } from "node:crypto";

export const THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
export const THUMBNAIL_TIMEOUT_MS = 5000;

export function thumbnailName(streamId, hash, extension) {
    // Hash the ID to keep attachment names safe and unambiguous across broadcasts.
    const broadcast = createHash("sha256").update(String(streamId)).digest("hex").slice(0, 24);
    return `twitch-${broadcast}-${hash}.${extension}`;
}

export function isBroadcastThumbnail(name, streamId) {
    if (!streamId || !name) return false;
    const prefix = thumbnailName(streamId, "", "").slice(0, -1);
    return name.startsWith(prefix) && /^twitch-[a-f0-9]{24}-[a-f0-9]{64}\.(jpg|png)$/.test(name);
}

export async function fetchTwitchThumbnail(liveData, { get = axios.get, now = Date.now } = {}) {
    if (!liveData.streamId || !liveData.thumbnailUrl) return null;
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
    try {
        const url = new URL(liveData.thumbnailUrl);
        if (url.protocol !== "https:" || url.hostname !== "static-cdn.jtvnw.net" || url.username || url.password || url.port) return null;
        url.searchParams.set("dlw_stream", liveData.streamId);
        url.searchParams.set("dlw_refresh", String(now()));
        response = await get(url.toString(), {
            responseType: "stream",
            timeout: THUMBNAIL_TIMEOUT_MS,
            signal: controller.signal,
            maxRedirects: 0,
            maxContentLength: THUMBNAIL_MAX_BYTES,
            headers: { "Cache-Control": "no-cache" }
        });
        if (response.status !== 200 || Number(response.headers["content-length"]) > THUMBNAIL_MAX_BYTES) return null;
        const startedAt = Date.parse(liveData.startedAt);
        const modifiedAt = Date.parse(response.headers["last-modified"]);
        // Reject demonstrably older CDN objects when Twitch supplies usable metadata.
        // A cache-busting query alone cannot prove the pixels belong to this broadcast.
        if (Number.isFinite(startedAt) && Number.isFinite(modifiedAt) && modifiedAt < startedAt) return null;
        const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg", "image/png"].includes(type)) return null;
        const chunks = [];
        let size = 0;
        for await (const chunk of response.data) {
            size += chunk.length;
            if (size > THUMBNAIL_MAX_BYTES) return null;
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks, size);
        const jpeg = type === "image/jpeg" && size > 4 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && buffer.subarray(-2).equals(Buffer.from([255, 217]));
        const png = type === "image/png" && size >= 45 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(-8, -4).toString() === "IEND";
        if (!jpeg && !png) return null;
        const hash = createHash("sha256").update(buffer).digest("hex");
        return { buffer, name: thumbnailName(liveData.streamId, hash, jpeg ? "jpg" : "png") };
    } catch {
        // Never log HTTP error objects here: they may include request details.
        return null;
    } finally {
        clearTimeout(timeout);
        response?.data?.destroy();
    }
}
