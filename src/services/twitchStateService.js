// Twitch-only lifecycle. Dependencies are injected so tests never need credentials or a database.
export function createTwitchStateHandler({ getConfig, updateState, sendLive, refreshImage, setOffline, fetchImage, intervalMs, logger, now = Date.now }) {
    const operations = new Map();
    const attempts = new Map();
    const maxEntries = 10000;

    async function process(client, configId, getLiveData) {
        const config = await getConfig(configId);
        if (!config?.isActive || config.platform !== "twitch") return;
        const data = await getLiveData(config);
        if (!data.found || data.status === "unknown") return;
        const observedConfig = await getConfig(configId);
        if (!observedConfig?.isActive || observedConfig.platformUsername !== config.platformUsername ||
            observedConfig.discordChannelId !== config.discordChannelId ||
            observedConfig.state?.lastStreamId !== config.state?.lastStreamId ||
            observedConfig.state?.lastNotificationMessageId !== config.state?.lastNotificationMessageId) return;
        const state = config.state || {};
        const timestamp = new Date(now());
        if (!data.isLive) {
            let thumbnailState = {};
            let completedAttempt = null;
            const key = `offline:${state.lastStreamId}:${state.lastNotificationMessageId}`;
            const attempt = attempts.get(configId);
            if (state.lastNotificationMessageId && (state.isLive || !attempt || attempt.key !== key || (!attempt.done && now() - attempt.at >= intervalMs))) {
                if (attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value);
                const next = { key, at: now(), done: false };
                attempts.set(configId, next);
                try {
                    const result = await setOffline(client, config, state, data);
                    next.done = Boolean(result);
                    if (next.done) completedAttempt = next;
                    if (result && typeof result === "object" && "thumbnailUrl" in result) thumbnailState = { lastThumbnailUrl: result.thumbnailUrl };
                    if (!next.done) logger.warn({ configId }, "Twitch offline notification unavailable; will retry");
                } catch {
                    logger.warn({ configId }, "Twitch offline notification edit failed");
                }
            }
            try {
                await updateState(configId, { isLive: false, lastCheckedAt: timestamp, ...thumbnailState });
            } catch (error) {
                // Do not mark reconciliation complete before its reference is durable.
                if (completedAttempt) completedAttempt.done = false;
                throw error;
            }
            if (state.isLive) logger.info?.({ configId, streamId: state.lastStreamId }, "Twitch streamer went offline");
            return;
        }
        if (!data.streamId) return;
        const sameBroadcast = state.lastStreamId === data.streamId;
        const needsNotification = !sameBroadcast || !state.lastNotificationMessageId;
        const key = `${data.streamId}:${state.lastNotificationMessageId || ""}`;
        const attempt = attempts.get(configId);
        const due = needsNotification || !attempt || attempt.key !== key || now() - attempt.at >= intervalMs;
        let image = null;
        if (due) {
            // Bound metadata only; never cache image buffers. Failed attempts are throttled too.
            if (attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value);
            attempts.set(configId, { key, at: now() });
            image = await fetchImage(data);
            if (!image) logger.warn({ configId, streamId: data.streamId }, "Twitch thumbnail unavailable; retaining safe fallback");
        }
        // Commands can reset/reassign a watch while the HTTP request is in flight.
        const current = await getConfig(configId);
        if (!current?.isActive || current.platformUsername !== config.platformUsername ||
            current.discordChannelId !== config.discordChannelId ||
            current.state?.lastStreamId !== config.state?.lastStreamId ||
            current.state?.lastNotificationMessageId !== config.state?.lastNotificationMessageId) return;
        let thumbnailUrl = sameBroadcast ? state.lastThumbnailUrl : null;
        let notification;
        if (needsNotification) {
            if (!sameBroadcast && state.lastStreamId && state.lastNotificationMessageId && state.lastNotificationChannelId) {
                // Retire the old message before replacing the only durable pointer to it.
                // Failure leaves the previous ID available for the next watcher attempt.
                const retired = await setOffline(client, config, state, {});
                if (!retired) throw new Error("Previous Twitch notification could not be marked offline");
            }
            notification = await sendLive(client, config, { ...data, thumbnailUrl: null }, image);
            thumbnailUrl = notification.thumbnailUrl || null;
            attempts.set(configId, { key: `${data.streamId}:${notification.messageId}`, at: now() });
        } else if (due) {
            try {
                const reference = await refreshImage(client, config, state, data, image);
                if (reference !== undefined) thumbnailUrl = reference;
            } catch {
                logger.warn({ configId, streamId: data.streamId }, "Twitch thumbnail refresh failed");
            }
        }
        await updateState(configId, {
            isLive: true,
            lastStreamId: data.streamId,
            lastTitle: data.title || null,
            lastStreamUrl: data.url || null,
            lastThumbnailUrl: thumbnailUrl?.startsWith("attachment://") ? thumbnailUrl : null,
            lastCheckedAt: timestamp,
            ...(notification ? {
                lastNotificationMessageId: notification.messageId,
                lastNotificationChannelId: notification.channelId,
                lastAnnouncedAt: timestamp
            } : {})
        });
        if (notification) logger.info?.({ configId, streamId: data.streamId, messageId: notification.messageId }, "Sent Twitch live notification");
    }

    return async function handle(client, config, dataOrLoader) {
        const previous = operations.get(config.id) || Promise.resolve();
        const operation = previous.catch(() => {}).then(() => process(client, config.id,
            typeof dataOrLoader === "function" ? dataOrLoader : async () => dataOrLoader));
        operations.set(config.id, operation);
        try {
            await operation;
        } finally {
            if (operations.get(config.id) === operation) operations.delete(config.id);
        }
    };
}
