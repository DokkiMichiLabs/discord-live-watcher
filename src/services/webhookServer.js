import http from "http";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
    isValidEulerWebhookSignature,
    processEulerLiveAlertWebhook,
    getExpectedEulerWebhookSignature
} from "./eulerWebhookService.js";

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        req.on("data", chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        req.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf8"));
        });

        req.on("error", reject);
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

export function startWebhookServer(client) {
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

            if (req.method === "GET" && url.pathname === "/health") {
                sendJson(res, 200, { ok: true });
                return;
            }

            if (req.method !== "POST" || url.pathname !== env.eulerWebhookPath) {
                sendJson(res, 404, { error: "Not found" });
                return;
            }

            if (!env.eulerAlertsEnabled) {
                sendJson(res, 503, { error: "Euler alerts are disabled" });
                return;
            }

            const rawBody = await readRawBody(req);
            const signature = req.headers["x-webhook-signature"];
            const expectedSignature = getExpectedEulerWebhookSignature(rawBody);

            if (typeof signature === "string") {
                logger.info(
                    {
                        receivedSignaturePrefix: signature.slice(0, 12),
                        expectedSignaturePrefix: expectedSignature?.slice(0, 12) ?? null,
                        signatureLength: signature.length,
                        rawBodyLength: rawBody.length
                    },
                    "Euler webhook signature debug"
                );
            }

            if (typeof signature === "string") {
                logger.info(
                    {
                        path: url.pathname,
                        signatureLength: signature.length,
                        rawBodyLength: rawBody.length,
                        rawBodyPreview: rawBody.slice(0, 300)
                    },
                    "Received Euler webhook before signature validation"
                );
            }

            if (typeof signature !== "string" || !isValidEulerWebhookSignature(rawBody, signature)) {
                logger.warn(
                    {
                        path: url.pathname,
                        hasSignature: typeof signature === "string"
                    },
                    "Rejected Euler webhook due to invalid signature"
                );
                sendJson(res, 401, { error: "Invalid signature" });
                return;
            }

            let payload;
            try {
                payload = JSON.parse(rawBody);
            } catch {
                sendJson(res, 400, { error: "Invalid JSON body" });
                return;
            }

            const result = await processEulerLiveAlertWebhook(client, payload);
            sendJson(res, 200, { ok: true, result });
        } catch (error) {
            logger.error({ error }, "Webhook server request failed");
            sendJson(res, 500, { error: "Internal server error" });
        }
    });

    server.listen(env.webhookPort, () => {
        logger.info(
            {
                port: env.webhookPort,
                eulerWebhookPath: env.eulerWebhookPath
            },
            "Webhook server listening"
        );
    });

    return server;
}
