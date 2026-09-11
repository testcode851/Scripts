function normalizeCommand(command) {
  if (typeof command === "function") {
    return { execute: command, mutates: false, history: false };
  }
  if (!command || typeof command.execute !== "function") {
    throw new TypeError("A command requires an executable function.");
  }
  return {
    execute: command.execute,
    mutates: Boolean(command.mutates),
    history: command.history !== false,
  };
}

export function createCommandRegistry(initialCommands = {}, options = {}) {
  const commands = new Map(
    Object.entries(initialCommands).map(([name, command]) => [name, normalizeCommand(command)])
  );
  const history = options.history;

  return {
    register(name, execute) {
      if (!name || typeof execute !== "function") {
        throw new TypeError("A command requires a name and executable function.");
      }
      commands.set(name, normalizeCommand(execute));
      return () => commands.delete(name);
    },
    has(name) {
      return commands.has(name);
    },
    execute(name, payload) {
      const command = commands.get(name);
      if (!command) return false;
      const run = () => command.execute(payload);
      const result =
        command.mutates && command.history && history?.transaction
          ? history.transaction(run, { record: command.history })
          : run();
      return result !== false;
    },
  };
}

export function bindCommandElements(root, registry) {
  const handleClick = (event) => {
    const element = event.target.closest?.("[data-command]");
    if (!element || !root.contains(element)) return;
    registry.execute(element.dataset.command, { event, element });
  };

  root.addEventListener("click", handleClick);
  return () => root.removeEventListener("click", handleClick);
}
