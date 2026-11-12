import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadIntegrationConfig, integrationChildEnvironment } from "./integration-test-config.js";

// No app import, Discord login, database connection, or HTTP request on the check path.
try {
    const action = process.argv[2] || "check";
    const path = process.argv[3] || ".env.test";
    if (!["check", "migrate", "seed", "start"].includes(action)) throw new Error("Use check, migrate, seed or start");
    const config = loadIntegrationConfig(path);
    if (action === "check") {
        console.log("Isolated test configuration passed structural checks. No network or database access performed. Resource ownership must still be verified manually.");
    } else {
        const args = action === "migrate"
            ? ["node_modules/prisma/build/index.js", "migrate", "deploy"]
            : ["scripts/integration-test-db.js", action];
        const child = spawn(process.execPath, args, {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: integrationChildEnvironment(config, path), stdio: "inherit", windowsHide: true
        });
        child.on("error", () => { console.error("Failed to launch isolated test action"); process.exitCode = 1; });
        child.on("exit", code => { process.exitCode = code ?? 1; });
    }
} catch (error) {
    // Validation errors contain setting names only, never credentials/URLs.
    console.error(error.message);
    process.exitCode = 1;
}
