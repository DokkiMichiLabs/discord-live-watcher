import * as setStream from "./commands/setStream.js";
import * as removeStream from "./commands/removeStream.js";
import * as showStreams from "./commands/showStreams.js";

const commands = new Map([
    [setStream.data.name, setStream],
    [removeStream.data.name, removeStream],
    [showStreams.data.name, showStreams]
]);

export async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);
}