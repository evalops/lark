export type SlashCommandHandler = (args: string) => Promise<void> | void;

export interface SlashCommand {
  handler: SlashCommandHandler;
  description: string;
}

const registry: Record<string, SlashCommand> = {};

export function registerCommand(name: string, handler: SlashCommandHandler, description: string) {
  registry[name] = { handler, description };
}

export function getCommand(name: string): SlashCommand | undefined {
  return registry[name];
}

export function getRegistry(): Record<string, SlashCommand> {
  return registry;
}

export async function handleSlashCommand(
  input: string,
  onError: (error: unknown) => void
): Promise<boolean> {
  const [cmdName, ...argsParts] = input.trim().split(/\s+/);
  const command = registry[cmdName];

  if (command) {
    try {
      await command.handler(argsParts.join(' '));
    } catch (err) {
      onError(err);
    }
    return true;
  }
  return false;
}

export function resetRegistry() {
  for (const key in registry) delete registry[key];
}
