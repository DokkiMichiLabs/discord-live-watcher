export function startConfiguredMonitoring(client, settings, services) {
    if (settings.webhookServerEnabled) services.startWebhookServer(client);
    services.startTwitchWatcher(client, settings.twitchWatchIntervalMs);
    if (settings.tiktokWatcherEnabled) services.startTikTokWatcher(client);
}
