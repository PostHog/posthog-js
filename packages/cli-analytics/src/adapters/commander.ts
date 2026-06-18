import type { CliAnalytics, CommandOptions } from '../types'

/**
 * Minimal structural view of a Commander `Command`. Typed locally (rather than
 * importing `commander`) so the adapter adds no runtime dependency — it works
 * with any object that exposes these members, mirroring how the MCP SDK types
 * `MCPServerLike`.
 */
export interface CommanderCommandLike {
    name(): string
    opts(): Record<string, unknown>
    args: string[]
    parent?: CommanderCommandLike | null
    hook(
        event: 'preAction' | 'postAction',
        listener: (thisCommand: CommanderCommandLike, actionCommand: CommanderCommandLike) => void
    ): CommanderCommandLike
}

export interface InstrumentCommanderOptions {
    /** Map an action command to an intent string (e.g. read a `--intent` flag). */
    intentFrom?: (command: CommanderCommandLike) => string | undefined
}

/** Walk from an action command up to (not including) the root program. */
function commandPath(command: CommanderCommandLike): string[] {
    const names: string[] = []
    let current: CommanderCommandLike | null | undefined = command
    while (current && current.parent) {
        names.unshift(current.name())
        current = current.parent
    }
    return names
}

function toCommandOptions(command: CommanderCommandLike, intent: string | undefined): CommandOptions {
    const [, ...rest] = commandPath(command)
    return {
        subcommand: rest.length > 0 ? rest.join(' ') : undefined,
        // `opts()` keys are the flag NAMES the user supplied — values are never read.
        flags: Object.keys(command.opts()),
        argsCount: Array.isArray(command.args) ? command.args.length : 0,
        intent,
        intentSource: intent ? 'flag' : undefined,
    }
}

/**
 * Auto-instruments a Commander program: opens a {@link CommandTracker} in
 * `preAction` and finishes it in `postAction`, so every command run emits
 * `$cli_command_run` with its measured duration, command path, and flag names.
 *
 * Commander does not surface action errors to `postAction`, so failures are not
 * auto-captured here — capture those by passing the caught error to
 * `analytics.trackCommand({ ..., error })` in your top-level handler. Always
 * `await analytics.shutdown()` after `program.parseAsync()` to flush.
 */
export function instrumentCommander(
    program: CommanderCommandLike,
    analytics: CliAnalytics,
    options: InstrumentCommanderOptions = {}
): void {
    const trackers = new WeakMap<CommanderCommandLike, ReturnType<CliAnalytics['command']>>()

    program.hook('preAction', (_thisCommand, actionCommand) => {
        const intent = options.intentFrom?.(actionCommand)
        const [command] = commandPath(actionCommand)
        trackers.set(
            actionCommand,
            analytics.command(command ?? actionCommand.name(), toCommandOptions(actionCommand, intent))
        )
    })

    program.hook('postAction', (_thisCommand, actionCommand) => {
        trackers.get(actionCommand)?.finish({ exitCode: 0 })
    })
}
