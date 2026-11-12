import { loadIntegrationConfig, integrationWatch, assertSingleIntegrationWatch, integrationChildEnvironment } from "./integration-test-config.js";

const config = loadIntegrationConfig(process.env.DOTENV_CONFIG_PATH);
// Also fail safely if this helper is invoked directly from a shell with inherited settings.
const isolated = integrationChildEnvironment(config, process.env.DOTENV_CONFIG_PATH || ".env.test");
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolated);
const { prisma } = await import("../src/db/prisma.js");
try {
    const expected = integrationWatch(config);
    if (process.argv[2] === "seed") {
        await prisma.$transaction(async tx => {
            const rows = await tx.streamWatchConfig.findMany({ include: { state: true } });
            if (rows.length) assertSingleIntegrationWatch(rows, expected);
            else await tx.streamWatchConfig.create({ data: { ...expected, state: { create: {} } } });
        });
        console.log("Exactly one isolated Twitch watch is configured; existing broadcast state was preserved.");
        await prisma.$disconnect();
    } else if (process.argv[2] === "start") {
        const rows = await prisma.streamWatchConfig.findMany({ include: { state: true } });
        assertSingleIntegrationWatch(rows, expected);
        // Login and watchers are imported only after successful local DB checks.
        await import("../src/index.js");
    } else {
        throw new Error("Use the integration-local.js launcher");
    }
} catch {
    console.error("Isolated database check/action failed. Check local DB availability, migrations and the single-watch configuration; no Discord startup was authorized by this check.");
    await prisma.$disconnect();
    process.exitCode = 1;
}
