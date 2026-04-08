import { updateStreamState } from "../repositories/streamWatchRepository.js";
import {
    sendLiveNotification,
    updateLiveNotificationToOffline
} from "./notificationService.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

function isTikTokOfflineErrorMessage(errorMessage) {
    return /the requested user isn't online/i.test(errorMessage || "");
}

export async function handleStreamStateTransition(client, config, liveData) {
    const now = new Date();

    await updateStreamState(config.id, {
        lastCheckedAt: now,
        ...(liveData.title ? { lastTitle: liveData.title } : {}),
        ...(liveData.thumbnailUrl ? { lastThumbnailUrl: liveData.thumbnailUrl } : {}),
        ...(liveData.url ? { lastStreamUrl: liveData.url } : {})
    });

    if (!liveData.found) {
        logger.warn(
            {
                platform: config.platform,
                username: config.platformUsername,
                error: liveData.error || null
            },
            "Platform user not found"
        );
        return;
    }

    const normalizedLiveData =
        config.platform === "tiktok" &&
        liveData.status === "unknown" &&
        isTikTokOfflineErrorMessage(liveData.error)
            ? {
                ...liveData,
                isLive: false,
                status: "offline"
            }
            : liveData;

    if (normalizedLiveData.status === "unknown") {
        const wasLive = Boolean(config.state?.isLive);
        const lastConfirmedAt = config.state?.lastCheckedAt
            ? new Date(config.state.lastCheckedAt).getTime()
            : 0;
        const isStaleLiveState =
            wasLive &&
            lastConfirmedAt > 0 &&
            Date.now() - lastConfirmedAt >= env.tiktokUnknownLiveGraceMs;

        if (config.platform === "tiktok" && isStaleLiveState) {
            const didUpdateMessage = await updateLiveNotificationToOffline(
                client,
                config,
                config.state,
                {
                    ...normalizedLiveData,
                    isLive: false,
                    status: "offline"
                }
            );

            await updateStreamState(config.id, {
                isLive: false,
                lastCheckedAt: now
            });

            logger.warn(
                {
                    platform: config.platform,
                    username: config.platformUsername,
                    updatedNotification: didUpdateMessage,
                    graceMs: env.tiktokUnknownLiveGraceMs
                },
                "Reset stale TikTok live state after repeated unknown checks"
            );
            return;
        }

        logger.warn(
            {
                platform: config.platform,
                username: config.platformUsername,
                error: normalizedLiveData.error || null
            },
            "Live status unknown, skipping state update"
        );
        return;
    }

    const wasLive = Boolean(config.state?.isLive);
    const isNowLive = Boolean(normalizedLiveData.isLive);

    if (!wasLive && isNowLive) {
        if (
            config.state?.lastStreamId &&
            normalizedLiveData.streamId &&
            config.state.lastStreamId === normalizedLiveData.streamId
        ) {
            await updateStreamState(config.id, {
                isLive: true,
                lastCheckedAt: now,
                lastTitle: normalizedLiveData.title || null,
                lastThumbnailUrl: normalizedLiveData.thumbnailUrl || null,
                lastStreamUrl: normalizedLiveData.url || null
            });

            logger.info(
                {
                    platform: config.platform,
                    username: config.platformUsername,
                    streamId: normalizedLiveData.streamId
                },
                "Skipped duplicate live notification"
            );

            return;
        }

        const notification = await sendLiveNotification(client, config, normalizedLiveData);

        await updateStreamState(config.id, {
            isLive: true,
            lastStreamId: normalizedLiveData.streamId || null,
            lastTitle: normalizedLiveData.title || null,
            lastThumbnailUrl: normalizedLiveData.thumbnailUrl || null,
            lastStreamUrl: normalizedLiveData.url || null,
            lastNotificationMessageId: notification.messageId,
            lastNotificationChannelId: notification.channelId,
            lastAnnouncedAt: now,
            lastCheckedAt: now
        });

        logger.info(
            {
                platform: config.platform,
                username: config.platformUsername,
                streamId: normalizedLiveData.streamId || null,
                notificationMessageId: notification.messageId
            },
            "Sent live notification"
        );

        return;
    }

    if (wasLive && !isNowLive) {
        const didUpdateMessage = await updateLiveNotificationToOffline(
            client,
            config,
            config.state,
            normalizedLiveData
        );

        await updateStreamState(config.id, {
            isLive: false,
            lastCheckedAt: now
        });

        logger.info(
            {
                platform: config.platform,
                username: config.platformUsername,
                updatedNotification: didUpdateMessage
            },
            "Streamer went offline"
        );

        return;
    }

    if (isNowLive) {
        await updateStreamState(config.id, {
            isLive: true,
            lastStreamId: normalizedLiveData.streamId || null,
            lastTitle: normalizedLiveData.title || null,
            lastThumbnailUrl: normalizedLiveData.thumbnailUrl || null,
            lastStreamUrl: normalizedLiveData.url || null,
            lastCheckedAt: now
        });
    }
}
