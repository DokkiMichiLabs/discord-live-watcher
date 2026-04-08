import crypto from "crypto";
import {
    findActiveTikTokConfigsByAlertId,
    findActiveTikTokConfigsByUsername
} from "../repositories/streamWatchRepository.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { handleStreamStateTransition } from "./streamStateService.js";

function generateSignature(secret, payload) {
    return crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
}

export function isValidEulerWebhookSignature(payload, receivedSignature) {
    if (!env.eulerWebhookSecret || !receivedSignature) {
        return false;
    }

    const expectedSignature = generateSignature(env.eulerWebhookSecret, payload);

    try {
        return crypto.timingSafeEqual(
            Buffer.from(receivedSignature, "hex"),
            Buffer.from(expectedSignature, "hex")
        );
    } catch {
        return false;
    }
}

function pickFirst(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return null;
}

function pickFirstString(...values) {
    const value = pickFirst(...values);
    return value === null ? null : String(value);
}

function normalizeUsername(payload) {
    const uniqueId = pickFirstString(
        payload?.metadata?.platformUsername,
        payload?.unique_id,
        payload?.uniqueId,
        payload?.room_info?.owner?.display_id,
        payload?.roomInfo?.owner?.display_id,
        payload?.room_info?.owner?.unique_id,
        payload?.roomInfo?.owner?.unique_id,
        payload?.room_info?.owner?.uniqueId,
        payload?.roomInfo?.owner?.uniqueId,
        payload?.owner?.unique_id,
        payload?.owner?.uniqueId,
        payload?.user?.unique_id,
        payload?.user?.uniqueId,
        payload?.broadcaster?.unique_id,
        payload?.broadcaster?.uniqueId,
        payload?.data?.unique_id,
        payload?.data?.uniqueId,
        payload?.data?.user?.unique_id,
        payload?.data?.user?.uniqueId,
        payload?.data?.owner?.unique_id,
        payload?.data?.owner?.uniqueId
    );

    return uniqueId ? uniqueId.replace(/^@/, "").trim().toLowerCase() : null;
}

function extractAlertId(payload) {
    return pickFirstString(
        payload?.alert_id,
        payload?.alertId,
        payload?.data?.alert_id,
        payload?.data?.alertId,
        payload?.metadata?.alertId
    );
}

function inferIsLive(payload) {
    const explicit = pickFirst(
        payload?.isLive,
        payload?.is_live,
        payload?.data?.isLive,
        payload?.data?.is_live,
        payload?.room_info?.is_live,
        payload?.roomInfo?.is_live,
        payload?.room_info?.isLive,
        payload?.roomInfo?.isLive
    );

    if (typeof explicit === "boolean") {
        return explicit;
    }

    const statusValue = pickFirst(
        payload?.status,
        payload?.stream_status,
        payload?.streamStatus,
        payload?.event,
        payload?.type,
        payload?.data?.status,
        payload?.data?.stream_status,
        payload?.data?.streamStatus,
        payload?.data?.event,
        payload?.data?.type
    );

    const normalizedStatus = statusValue ? String(statusValue).toLowerCase() : "";

    if (/live|started|start|online|active/.test(normalizedStatus)) {
        return true;
    }

    if (/offline|ended|end|stopped|stop|inactive/.test(normalizedStatus)) {
        return false;
    }

    const numericStatus = Number(pickFirst(
        payload?.room_info?.status,
        payload?.roomInfo?.status,
        payload?.data?.room_info?.status,
        payload?.data?.roomInfo?.status
    ));

    if (!Number.isNaN(numericStatus)) {
        if (numericStatus === 2) {
            return true;
        }

        if (numericStatus === 4 || numericStatus === 0) {
            return false;
        }
    }

    const roomId = pickFirstString(
        payload?.room_id,
        payload?.roomId,
        payload?.room_info?.room_id,
        payload?.roomInfo?.room_id,
        payload?.room_info?.roomId,
        payload?.roomInfo?.roomId,
        payload?.data?.room_id,
        payload?.data?.roomId
    );

    if (roomId) {
        return true;
    }

    return null;
}

function originalBuildLiveDataFromWebhook(config, payload) {
    const roomId = pickFirstString(
        payload?.room_id,
        payload?.roomId,
        payload?.room_info?.room_id,
        payload?.roomInfo?.room_id,
        payload?.room_info?.roomId,
        payload?.roomInfo?.roomId,
        payload?.data?.room_id,
        payload?.data?.roomId
    );
    const title = pickFirstString(
        payload?.title,
        payload?.room_info?.title,
        payload?.roomInfo?.title,
        payload?.data?.title,
        payload?.data?.room_info?.title,
        payload?.data?.roomInfo?.title
    );
    const displayName = pickFirstString(
        payload?.display_name,
        payload?.displayName,
        payload?.room_info?.owner?.nickname,
        payload?.roomInfo?.owner?.nickname,
        payload?.data?.display_name,
        payload?.data?.displayName,
        config.platformUsername
    );
    const thumbnailUrl = pickFirstString(
        payload?.thumbnailUrl,
        payload?.thumbnail_url,
        payload?.cover_url,
        payload?.coverUrl,
        payload?.room_info?.cover?.url_list?.[0],
        payload?.roomInfo?.cover?.url_list?.[0],
        payload?.room_info?.cover?.urlList?.[0],
        payload?.roomInfo?.cover?.urlList?.[0],
        payload?.data?.thumbnailUrl,
        payload?.data?.thumbnail_url,
        payload?.data?.cover_url,
        payload?.data?.coverUrl
    );
    const username = normalizeUsername(payload) || config.platformUsername;
    const isLive = inferIsLive(payload);

    return {
        found: true,
        isLive,
        status: isLive === null ? "unknown" : isLive ? "live" : "offline",
        streamId: roomId,
        title,
        displayName,
        username,
        thumbnailUrl,
        url: username ? `https://www.tiktok.com/@${username}` : null,
        rawPayload: payload
    };
}

function buildLiveDataFromWebhook(config, payload) {
    const isDashboardPayload =
        payload?.username || payload?.title || payload?.cover_url;

    if (isDashboardPayload) {
        const username = String(payload.username || config.platformUsername)
            .replace(/^@/, "")
            .trim()
            .toLowerCase();

        return {
            found: true,
            isLive: true,
            status: "live",
            streamId: null,
            title: payload.title || null,
            displayName: payload.username || config.platformUsername,
            username,
            thumbnailUrl: payload.cover_url || null,
            avatarUrl: payload.avatar_url || null,
            url: `https://www.tiktok.com/@${username}`,
            rawPayload: payload
        };
    }

    return originalBuildLiveDataFromWebhook(config, payload);
}

async function resolveConfigsForPayload(payload) {
    const alertId = extractAlertId(payload);
    const username = normalizeUsername(payload);
    const configsById = new Map();

    if (alertId) {
        const byAlertId = await findActiveTikTokConfigsByAlertId(alertId);
        for (const config of byAlertId || []) {
            configsById.set(config.id, config);
        }
    }

    if (username) {
        const byUsername = await findActiveTikTokConfigsByUsername(username);
        for (const config of byUsername || []) {
            configsById.set(config.id, config);
        }
    }

    return Array.from(configsById.values());
}

export async function processEulerLiveAlertWebhook(client, payload) {
    let configs = await resolveConfigsForPayload(payload);

    // 🔥 Fallback for Euler Dashboard payload
    if (!configs.length) {
        const dashboardUsername = pickFirstString(
            payload?.username,
            payload?.user,
            payload?.nickname
        );

        if (dashboardUsername) {
            configs = await findActiveTikTokConfigsByUsername(
                dashboardUsername.replace(/^@/, "").trim().toLowerCase()
            );
        }
    }

    if (!configs.length) {
        logger.warn({ payload }, "Received Euler webhook but no matching TikTok config was found");
        return { handled: false, reason: "config_not_found" };
    }

    const results = [];

    for (const config of configs) {
        const liveData = buildLiveDataFromWebhook(config, payload);
        await handleStreamStateTransition(client, config, liveData);

        logger.info(
            {
                configId: config.id,
                username: config.platformUsername,
                status: liveData.status,
                streamId: liveData.streamId || null
            },
            "Processed Euler live alert webhook"
        );

        results.push({
            configId: config.id,
            status: liveData.status
        });
    }

    return { handled: true, results };
}
