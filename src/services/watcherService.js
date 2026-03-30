import { getActiveStreamConfigsByPlatform, updateStreamState } from "../repositories/streamWatchRepository.js";
import { getTwitchLiveStatus } from "../platforms/twitch/twitchAdapter.js";
import { sendLiveNotification } from "./notificationService.js";
import { logger } from "../utils/logger.js";

async function processTwitchConfig(client, config) {
    const liveData = await getTwitchLiveStatus(config.platformUsername);

    await updateStreamState(config.id, {
        lastCheckedAt: new Date(),
        lastTitle: liveData.title || null,
        lastThumbnailUrl: liveData.thumbnailUrl || null,
        lastStreamUrl: liveData.url || null
    });

    if (!liveData.found) {
        logger.warn({ username: config.platformUsername }, "Twitch user not found");
        return;
    }

    const wasLive = Boolean(config.state?.isLive);
    const isNowLive = Boolean(liveData.isLive);

    if (!wasLive && isNowLive) {
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
            { username: config.platformUsername, streamId: liveData.streamId },
            "Sent live notification"
        );

        return;
    }

    if (wasLive && !isNowLive) {
        await updateStreamState(config.id, {
            isLive: false,
            lastCheckedAt: new Date()
        });

        logger.info({ username: config.platformUsername }, "Streamer went offline");
        return;
    }

    if (isNowLive) {
        await updateStreamState(config.id, {
            isLive: true,
            lastStreamId: liveData.streamId || null,
            lastCheckedAt: new Date()
        });
    }
}

export function startWatcher(client, intervalMs) {
    async function tick() {
        try {
            const twitchConfigs = await getActiveStreamConfigsByPlatform("twitch");

            for (const config of twitchConfigs) {
                try {
                    await processTwitchConfig(client, config);
                } catch (error) {
                    logger.error(
                        { error, configId: config.id, username: config.platformUsername },
                        "Failed to process Twitch config"
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