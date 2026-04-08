# discord-live-watcher

Discord bot that watches Twitch and TikTok live status and posts notifications.

## TikTok LIVE Alerts via Euler Stream

This project now supports Euler Stream LIVE Alerts as the primary TikTok go-live trigger, while keeping polling as a fallback.

### Required environment variables

Copy `.env.example` and set:

- `EULER_ALERTS_ENABLED=true`
- `EULER_API_KEY`
- `EULER_ACCOUNT_ID`
- `EULER_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`
- `WEBHOOK_PORT`
- `EULER_WEBHOOK_PATH`

### Webhook endpoint

By default the bot listens on:

- `POST /webhooks/euler/live-alerts`
- `GET /health`

The Euler webhook signature is validated with the raw request body using the `x-webhook-signature` header, matching Euler's docs.

### Important setup steps

1. Run a Prisma migration for the new nullable Euler fields on `StreamWatchConfig`:
   - `eulerAlertId`
   - `eulerTargetId`
2. Run `prisma generate`.
3. Make sure your public URL routes to this bot's webhook port.
4. Re-save each TikTok stream with `/set-stream` so the bot can create/sync its Euler alert and target.

### Behavior

- TikTok configs now try to sync an Euler alert target automatically on `/set-stream`.
- TikTok configs attempt cleanup of that target on `/remove-stream`.
- `/show-streams` shows `alerts: webhook` when Euler is synced, otherwise `alerts: polling`.
- TikTok polling remains enabled as a fallback/reconciliation layer.
