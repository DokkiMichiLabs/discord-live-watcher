import { SignConfig, WebcastPushConnection } from "tiktok-live-connector";
import { env } from "../../config/env.js";
import {
    clearStreamConfigEulerSubscription,
    countOtherActiveTikTokConfigs,
    setStreamConfigEulerSubscription
} from "../../repositories/streamWatchRepository.js";
import { logger } from "../../utils/logger.js";

function requireEulerAlertsConfig() {
    if (!env.eulerAlertsEnabled) {
        throw new Error("Euler alerts are disabled. Set EULER_ALERTS_ENABLED=true to enable them.");
    }

    if (!env.eulerApiKey) {
        throw new Error("Missing EULER_API_KEY while Euler alerts are enabled.");
    }

    if (!env.eulerAccountId) {
        throw new Error("Missing EULER_ACCOUNT_ID while Euler alerts are enabled.");
    }

    if (!env.publicBaseUrl) {
        throw new Error("Missing PUBLIC_BASE_URL while Euler alerts are enabled.");
    }

    if (!env.eulerWebhookPath.startsWith("/")) {
        throw new Error("EULER_WEBHOOK_PATH must start with '/'.");
    }
}

function getWebhookUrl() {
    return `${env.publicBaseUrl.replace(/\/$/, "")}${env.eulerWebhookPath}`;
}

function getEulerClient() {
    requireEulerAlertsConfig();
    SignConfig.apiKey = env.eulerApiKey;

    const connection = new WebcastPushConnection("euler-alert-bootstrap", {
        enableExtendedGiftInfo: false
    });

    const sdk = connection.signer;

    if (!sdk?.alertsApi || !sdk?.alertTargetsApi) {
        throw new Error("Euler alert APIs are unavailable on the installed TikTok connector.");
    }

    return sdk;
}

async function unwrapApiResponse(response) {
    if (!response) {
        return null;
    }

    if (typeof response.json === "function") {
        return response.json();
    }

    if (typeof response.text === "function") {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    if (response.data !== undefined) {
        return response.data;
    }

    return response;
}

function pickFirstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function extractAlertId(payload) {
    return pickFirstString(
        payload?.id,
        payload?.alertId,
        payload?.alert_id,
        payload?.data?.id,
        payload?.data?.alertId,
        payload?.data?.alert_id,
        payload?.alert?.id,
        payload?.alert?.alertId,
        payload?.alert?.alert_id
    );
}

function extractTargetId(payload) {
    return pickFirstString(
        payload?.targetId,
        payload?.target_id,
        payload?.id,
        payload?.data?.targetId,
        payload?.data?.target_id,
        payload?.data?.id,
        payload?.target?.id,
        payload?.target?.targetId,
        payload?.target?.target_id
    );
}

function normalizeTargetsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    if (Array.isArray(payload?.targets)) {
        return payload.targets;
    }

    if (Array.isArray(payload?.items)) {
        return payload.items;
    }

    return [];
}

async function findExistingAlertForUsername(sdk, platformUsername) {
    const response = await sdk.alertsApi.listAlerts(env.eulerAccountId, true);
    const payload = await unwrapApiResponse(response);
    const alerts = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.alerts)
                ? payload.alerts
                : [];

    return alerts.find(alert => {
        const uniqueId = pickFirstString(
            alert?.unique_id,
            alert?.uniqueId,
            alert?.data?.unique_id,
            alert?.data?.uniqueId,
            alert?.target?.unique_id,
            alert?.target?.uniqueId
        );

        return uniqueId?.toLowerCase() === platformUsername.toLowerCase();
    }) || null;
}

async function findExistingTargetForWebhook(sdk, alertId) {
    const response = await sdk.alertTargetsApi.listAlertTargets(env.eulerAccountId, alertId);
    const payload = await unwrapApiResponse(response);
    const targets = normalizeTargetsPayload(payload);
    const webhookUrl = getWebhookUrl();

    return targets.find(target => target?.url === webhookUrl) || null;
}

export async function ensureTikTokAlertSubscription(config) {
    if (config.platform !== "tiktok") {
        return { skipped: true, reason: "not_tiktok" };
    }

    const sdk = getEulerClient();
    const platformUsername = config.platformUsername.replace(/^@/, "").trim();
    const webhookUrl = getWebhookUrl();

    let alertId = config.eulerAlertId;
    let targetId = config.eulerTargetId;

    if (!alertId) {
        const existingAlert = await findExistingAlertForUsername(sdk, platformUsername);
        alertId = extractAlertId(existingAlert);
    }

    if (!alertId) {
        const response = await sdk.alertsApi.createAlert(
            env.eulerAccountId,
            { unique_id: platformUsername },
            { params: { read_only: true } }
        );

        const payload = await unwrapApiResponse(response);
        alertId = extractAlertId(payload);

        if (!alertId) {
            throw new Error("Euler createAlert succeeded but no alert id was returned.");
        }
    }

    if (!targetId) {
        const existingTarget = await findExistingTargetForWebhook(sdk, alertId);
        targetId = extractTargetId(existingTarget);
    }

    if (!targetId) {
        const response = await sdk.alertTargetsApi.createAlertTarget(
            env.eulerAccountId,
            alertId,
            {
                url: webhookUrl,
                metadata: {
                    configId: config.id,
                    guildId: config.guildId,
                    discordChannelId: config.discordChannelId,
                    discordUserId: config.discordUserId,
                    platform: config.platform,
                    platformUsername: config.platformUsername
                }
            }
        );

        const payload = await unwrapApiResponse(response);
        targetId = extractTargetId(payload);

        if (!targetId) {
            throw new Error("Euler createAlertTarget succeeded but no target id was returned.");
        }
    }

    const updatedConfig = await setStreamConfigEulerSubscription(config.id, {
        eulerAlertId: alertId,
        eulerTargetId: targetId
    });

    logger.info(
        {
            configId: config.id,
            username: config.platformUsername,
            eulerAlertId: alertId,
            eulerTargetId: targetId,
            webhookUrl
        },
        "Synced TikTok Euler alert subscription"
    );

    return {
        config: updatedConfig,
        eulerAlertId: alertId,
        eulerTargetId: targetId,
        webhookUrl
    };
}

export async function removeTikTokAlertSubscription(config) {
    if (!env.eulerAlertsEnabled || config.platform !== "tiktok") {
        return { skipped: true };
    }

    const sdk = getEulerClient();
    const alertId = config.eulerAlertId;
    const targetId = config.eulerTargetId;

    if (alertId && targetId) {
        try {
            await sdk.alertTargetsApi.deleteAlertTarget(env.eulerAccountId, alertId, targetId);
        } catch (error) {
            logger.warn(
                {
                    error,
                    configId: config.id,
                    eulerAlertId: alertId,
                    eulerTargetId: targetId
                },
                "Failed deleting Euler alert target directly; continuing cleanup"
            );
        }
    }

    if (alertId) {
        try {
            const otherConfigCount = await countOtherActiveTikTokConfigs({
                excludeConfigId: config.id,
                eulerAlertId: alertId,
                platformUsername: config.platformUsername
            });

            if (otherConfigCount === 0) {
                await sdk.alertsApi.deleteAlert(env.eulerAccountId, alertId);
            }
        } catch (error) {
            logger.warn(
                {
                    error,
                    configId: config.id,
                    eulerAlertId: alertId
                },
                "Failed deleting Euler alert; continuing cleanup"
            );
        }
    }

    await clearStreamConfigEulerSubscription(config.id);

    return {
        eulerAlertId: alertId,
        eulerTargetId: targetId
    };
}
