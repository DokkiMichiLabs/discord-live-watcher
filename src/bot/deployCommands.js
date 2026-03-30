import { REST, Routes } from "discord.js";
import { env } from "../config/env.js";
import * as setStream from "./commands/setStream.js";
import * as removeStream from "./commands/removeStream.js";
import * as showStreams from "./commands/showStreams.js";

const commands = [
    setStream.data.toJSON(),
    removeStream.data.toJSON(),
    showStreams.data.toJSON()
];

const rest = new REST({ version: "10" }).setToken(env.discordToken);

async function main() {
    await rest.put(
        Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId),
        { body: commands }
    );

    console.log("Guild slash commands deployed successfully.");
}

main().catch(error => {
    console.error("Failed to deploy commands:", error);
    process.exit(1);
});