import { WebcastPushConnection } from "tiktok-live-connector";

/**
 * Attempts to detect whether a TikTok user is currently live.
 *
 * Notes:
 * - This uses an unofficial library.
 * - We connect briefly, inspect the returned state/room info, then disconnect.
 * - We should treat failures as "unknown" rather than crashing the watcher.
 */
export async function getTikTokLiveStatus(username) {
    const normalizedUsername = username.replace(/^@/, "").trim();

    if (!normalizedUsername) {
        return {
            found: false,
            isLive: false,
            error: "Missing TikTok username"
        };
    }

    const tiktokUrl = `https://www.tiktok.com/@${normalizedUsername}`;

    const connection = new WebcastPushConnection(normalizedUsername, {
        enableExtendedGiftInfo: false
    });

    try {
        const state = await connection.connect();

        // If connect succeeds, the room is live.
        // The returned object shape can vary, so we keep extraction defensive.
        const roomId =
            state?.roomId ||
            state?.room_id ||
            state?.roomInfo?.roomId ||
            state?.roomInfo?.room_id ||
            null;

        const title =
            state?.roomInfo?.title ||
            state?.roomInfo?.liveRoomStats?.title ||
            state?.title ||
            null;

        const coverUrl =
            state?.roomInfo?.cover?.url_list?.[0] ||
            state?.roomInfo?.cover?.urlList?.[0] ||
            state?.roomInfo?.coverUrl ||
            null;

        return {
            found: true,
            isLive: true,
            streamId: roomId ? String(roomId) : null,
            title,
            displayName: normalizedUsername,
            username: normalizedUsername,
            thumbnailUrl: coverUrl,
            url: tiktokUrl
        };
    } catch (error) {
        const message = String(error?.message || "");

        // Treat common offline/not-live cases as "found but offline"
        if (
            /user offline/i.test(message) ||
            /not live/i.test(message) ||
            /live ended/i.test(message) ||
            /room.*not.*found/i.test(message)
        ) {
            return {
                found: true,
                isLive: false,
                displayName: normalizedUsername,
                username: normalizedUsername,
                url: tiktokUrl
            };
        }

        // Some failures may indicate the user cannot be resolved at all.
        if (
            /user.*not.*found/i.test(message) ||
            /uniqueid/i.test(message)
        ) {
            return {
                found: false,
                isLive: false,
                error: message
            };
        }

        return {
            found: true,
            isLive: false,
            error: message,
            displayName: normalizedUsername,
            username: normalizedUsername,
            url: tiktokUrl
        };
    } finally {
        try {
            connection.disconnect();
        } catch {
            // ignore disconnect cleanup errors
        }
    }
}