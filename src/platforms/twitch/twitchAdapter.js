import { getTwitchStreamByLogin, getTwitchUserByLogin } from "./twitchApi.js";

function formatThumbnailUrl(template) {
    if (!template) return null;

    return template
        .replace("{width}", "1280")
        .replace("{height}", "720");
}

export async function getTwitchLiveStatus(username) {
    const [user, stream] = await Promise.all([
        getTwitchUserByLogin(username),
        getTwitchStreamByLogin(username)
    ]);

    if (!user) {
        return {
            found: false,
            isLive: false
        };
    }

    if (!stream) {
        return {
            found: true,
            isLive: false,
            displayName: user.display_name,
            username: user.login,
            url: `https://www.twitch.tv/${user.login}`
        };
    }

    return {
        found: true,
        isLive: true,
        streamId: stream.id,
        title: stream.title,
        displayName: user.display_name,
        username: user.login,
        thumbnailUrl: formatThumbnailUrl(stream.thumbnail_url),
        url: `https://www.twitch.tv/${user.login}`
    };
}