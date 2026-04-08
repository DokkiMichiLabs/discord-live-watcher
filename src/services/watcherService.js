import {
    getActiveStreamConfigsByPlatform
} from "../repositories/streamWatchRepository.js";
import { getTwitchLiveStatus } from "../platforms/twitch/twitchAdapter.js";
import { getTikTokLiveStatus } from "../platforms/tiktok/tiktokAdapter.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { handleStreamStateTransition } from "./streamStateService.js";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isTikTokRateLimitError(errorMessage) {
    return /rate_limit_account_day/i.test(errorMessage || "");
}

function getTikTokIntervalMs(streamerCount) {
    if (streamerCount <= 0) {
        return env.tiktokIdleIntervalMs;
    }

    const rawMinutes = Math.ceil((streamerCount * 1440) / env.tiktokDailyBudget);
    const clampedMinutes = Math.max(
        env.tiktokMinIntervalMinutes,
        Math.min(env.tiktokMaxIntervalMinutes, rawMinutes)
    );

    return clampedMinutes * 60 * 1000;
}

async function processTwitchConfig(client, config) {
    const liveData = await getTwitchLiveStatus(config.platformUsername);
    await handleStreamStateTransition(client, config, liveData);
}

async function processTikTokConfig(client, config) {
    const liveData = await getTikTokLiveStatus(config.platformUsername);
    await handleStreamStateTransition(client, config, liveData);
    return liveData;
}

export function startTwitchWatcher(client, intervalMs = env.twitchWatchIntervalMs) {
    let isTickRunning = false;

    async function tick() {
        if (isTickRunning) {
            logger.warn("Skipping Twitch watcher tick because previous tick is still running");
            return;
        }

        isTickRunning = true;

        try {
            const twitchConfigs = await getActiveStreamConfigsByPlatform("twitch");

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
        } catch (error) {
            logger.error({ error }, "Twitch watcher tick failed");
        } finally {
            isTickRunning = false;
        }
    }

    tick();
    return setInterval(tick, intervalMs);
}

export function startTikTokWatcher(client) {
    let isTickRunning = false;
    let stopped = false;
    let timeoutHandle = null;
    let rateLimitedUntil = 0;

    function scheduleNext(delayMs) {
        if (stopped) return;

        clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(tick, delayMs);
    }

    async function tick() {
        if (stopped) {
            return;
        }

        if (isTickRunning) {
            logger.warn("Skipping TikTok watcher tick because previous tick is still running");
            scheduleNext(env.tiktokOverlapRetryMs);
            return;
        }

        isTickRunning = true;

        try {
            const now = Date.now();

            if (now < rateLimitedUntil) {
                const waitMs = rateLimitedUntil - now;
                logger.warn({ waitMs }, "TikTok watcher paused due to rate limit backoff");
                scheduleNext(waitMs);
                return;
            }

            const tiktokConfigs = await getActiveStreamConfigsByPlatform("tiktok");
            const intervalMs = getTikTokIntervalMs(tiktokConfigs.length);

            logger.info(
                {
                    streamerCount: tiktokConfigs.length,
                    intervalMs,
                    nextRunInMinutes: Number((intervalMs / 60000).toFixed(2))
                },
                "TikTok watcher interval computed"
            );

            for (const config of tiktokConfigs) {
                try {
                    const liveData = await processTikTokConfig(client, config);

                    if (
                        liveData?.status === "unknown" &&
                        isTikTokRateLimitError(liveData.error)
                    ) {
                        rateLimitedUntil = Date.now() + env.tiktokRateLimitBackoffMs;

                        logger.warn(
                            {
                                username: config.platformUsername,
                                until: new Date(rateLimitedUntil).toISOString()
                            },
                            "TikTok rate limit hit; backing off"
                        );
                        break;
                    }
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

                if (env.tiktokPerStreamerDelayMs > 0) {
                    await sleep(env.tiktokPerStreamerDelayMs);
                }
            }

            const nextDelayMs = rateLimitedUntil > Date.now()
                ? Math.max(rateLimitedUntil - Date.now(), 1000)
                : intervalMs;

            scheduleNext(nextDelayMs);
        } catch (error) {
            logger.error({ error }, "TikTok watcher tick failed");
            scheduleNext(env.tiktokFailureRetryMs);
        } finally {
            isTickRunning = false;
        }
    }

    tick();

    return {
        stop() {
            stopped = true;
            clearTimeout(timeoutHandle);
        }
    };
}
