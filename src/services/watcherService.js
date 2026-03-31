import {
    getActiveStreamConfigsByPlatform,
    updateStreamState
} from "../repositories/streamWatchRepository.js";
import { getTwitchLiveStatus } from "../platforms/twitch/twitchAdapter.js";
import { getTikTokLiveStatus } from "../platforms/tiktok/tiktokAdapter.js";
import { sendLiveNotification } from "./notificationService.js";
import { logger } from "../utils/logger.js";

async function handleStateTransition(client, config, liveData) {
    await updateStreamState(config.id, {
        lastCheckedAt: new Date(),
        lastTitle: liveData.title || null,
        lastThumbnailUrl: liveData.thumbnailUrl || null,
        lastStreamUrl: liveData.url || null
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

    const wasLive = Boolean(config.state?.isLive);
    const isNowLive = Boolean(liveData.isLive);

    if (!wasLive && isNowLive) {
        // Prevent duplicate post for same session if streamId already matches
        if (
            config.state?.lastStreamId &&
            liveData.streamId &&
            config.state.lastStreamId === liveData.streamId
        ) {
            await updateStreamState(config.id, {
                isLive: true,
                lastCheckedAt: new Date(),
                lastTitle: liveData.title || null,
                lastThumbnailUrl: liveData.thumbnailUrl || null,
                lastStreamUrl: liveData.url || null
            });

            logger.info(
                {
                    platform: config.platform,
                    username: config.platformUsername,
                    streamId: liveData.streamId
                },
                "Skipped duplicate live notification"
            );

            return;
        }

        await sendLiveNotification(client, config, liveData);

        await updateStreamState(config.id, {
            isLive: true,
            lastStreamId: liveData.streamId || null,
            lastTitle: liveData.title || null,
            lastThumbnailUrl: liveData.thumbnailUrl || null,
            lastStreamUrl: liveData.url || null,
            lastAnnouncedAt: new Date(),
            lastCheckedAt: new Date()
        });

        logger.info(
            {
                platform: config.platform,
                username: config.platformUsername,
                streamId: liveData.streamId || null
            },
            "Sent live notification"
        );

        return;
    }

    if (wasLive && !isNowLive) {
        await updateStreamState(config.id, {
            isLive: false,
            lastCheckedAt: new Date()
        });

        logger.info(
            {
                platform: config.platform,
                username: config.platformUsername
            },
            "Streamer went offline"
        );

        return;
    }

    if (isNowLive) {
        await updateStreamState(config.id, {
            isLive: true,
            lastStreamId: liveData.streamId || null,
            lastTitle: liveData.title || null,
            lastThumbnailUrl: liveData.thumbnailUrl || null,
            lastStreamUrl: liveData.url || null,
            lastCheckedAt: new Date()
        });
    }
}

async function processTwitchConfig(client, config) {
    const liveData = await getTwitchLiveStatus(config.platformUsername);
    await handleStateTransition(client, config, liveData);
}

async function processTikTokConfig(client, config) {
    const liveData = await getTikTokLiveStatus(config.platformUsername);
    await handleStateTransition(client, config, liveData);
}

export function startWatcher(client, intervalMs) {
    async function tick() {
        try {
            const [twitchConfigs, tiktokConfigs] = await Promise.all([
                getActiveStreamConfigsByPlatform("twitch"),
                getActiveStreamConfigsByPlatform("tiktok")
            ]);

            for (const config of twitchConfigs) {
                try {
                    await processTwitchConfig(client, config);
                } catch (error) {
                    logger.error(
                        {
                            error,
                            configId: config.id,
                            platform: "twitch",
                            username: config.platformUsername
                        },
                        "Failed to process Twitch config"
                    );
                }
            }

            for (const config of tiktokConfigs) {
                try {
                    await processTikTokConfig(client, config);
                } catch (error) {
                    logger.error(
                        {
                            error,
                            configId: config.id,
                            platform: "tiktok",
                            username: config.platformUsername
                        },
                        "Failed to process TikTok config"
                    );
                }
            }
        } catch (error) {
            logger.error({ error }, "Watcher tick failed");
        }
    }

    tick();
    return setInterval(tick, intervalMs);
}