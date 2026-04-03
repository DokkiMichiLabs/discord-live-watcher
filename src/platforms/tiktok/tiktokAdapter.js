import { WebcastPushConnection } from "tiktok-live-connector";

/**
 * Attempts to detect whether a TikTok user is currently live.
 *
 * Notes:
 * - This uses an unofficial library.
 * - We connect briefly, inspect the returned state/room info, then disconnect.
 * - We treat unexpected failures as "unknown" instead of "offline"
 *   to avoid missing live notifications.
 */
export async function getTikTokLiveStatus(username) {
    const normalizedUsername = username.replace(/^@/, "").trim();

    if (!normalizedUsername) {
        return {
            found: false,
            isLive: false,
            status: "invalid",
            error: "Missing TikTok username"
        };
    }

    const tiktokUrl = `https://www.tiktok.com/@${normalizedUsername}`;

    const connection = new WebcastPushConnection(normalizedUsername, {
        enableExtendedGiftInfo: false
    });

    try {
        const state = await connection.connect();

        // Extract room info defensively
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
            status: "live",
            streamId: roomId ? String(roomId) : null,
            title,
            displayName: normalizedUsername,
            username: normalizedUsername,
            thumbnailUrl: coverUrl,
            url: tiktokUrl
        };
    } catch (error) {
        const message = String(error?.message || "");

        // ✅ Known OFFLINE cases
        if (
            /user offline/i.test(message) ||
            /not live/i.test(message) ||
            /live ended/i.test(message) ||
            /room.*not.*found/i.test(message)
        ) {
            return {
                found: true,
                isLive: false,
                status: "offline",
                displayName: normalizedUsername,
                username: normalizedUsername,
                url: tiktokUrl
            };
        }

        // ❌ User not found
        if (
            /user.*not.*found/i.test(message) ||
            /uniqueid/i.test(message)
        ) {
            return {
                found: false,
                isLive: false,
                status: "not_found",
                error: message
            };
        }

        // ⚠️ Unknown / transient failure (IMPORTANT FIX)
        return {
            found: true,
            isLive: null,
            status: "unknown",
            error: message,
            displayName: normalizedUsername,
            username: normalizedUsername,
            url: tiktokUrl
        };
    } finally {
        try {
            await connection.disconnect();
        } catch {
            // ignore cleanup errors
        }
    }
}