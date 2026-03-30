import axios from "axios";
import { env } from "../../config/env.js";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAppAccessToken() {
    const now = Date.now();

    if (cachedToken && now < tokenExpiresAt) {
        return cachedToken;
    }

    const response = await axios.post("https://id.twitch.tv/oauth2/token", null, {
        params: {
            client_id: env.twitchClientId,
            client_secret: env.twitchClientSecret,
            grant_type: "client_credentials"
        }
    });

    cachedToken = response.data.access_token;
    tokenExpiresAt = now + (response.data.expires_in - 60) * 1000;

    return cachedToken;
}

export async function getTwitchStreamByLogin(login) {
    const token = await getAppAccessToken();

    const response = await axios.get("https://api.twitch.tv/helix/streams", {
        headers: {
            "Client-Id": env.twitchClientId,
            Authorization: `Bearer ${token}`
        },
        params: {
            user_login: login
        }
    });

    return response.data.data?.[0] || null;
}

export async function getTwitchUserByLogin(login) {
    const token = await getAppAccessToken();

    const response = await axios.get("https://api.twitch.tv/helix/users", {
        headers: {
            "Client-Id": env.twitchClientId,
            Authorization: `Bearer ${token}`
        },
        params: {
            login
        }
    });

    return response.data.data?.[0] || null;
}