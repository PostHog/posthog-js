# @posthog/cli-analytics

PostHog SDK for command-line tools. Auto-captures command usage — command, subcommand, flag names, exit code, duration, errors, and version — with a **first-class agent dimension** (is an AI agent or a human driving the CLI, and which agent) and optional **intent** capture that feeds the same clustering pipeline as [`@posthog/mcp`](../mcp).

It does **not** capture flag _values_, argument _values_, file paths, or file contents — only flag/command _names_ — so usage analytics never leak secrets.

## Install

```bash
pnpm add @posthog/cli-analytics posthog-node
```

`posthog-node` is a peer dependency — you construct and own the client.

## Usage

```ts
import { PostHog } from 'posthog-node'
import { instrument } from '@posthog/cli-analytics'

// For a short-lived CLI process, send immediately and flush on exit.
const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN, {
  host: 'https://us.i.posthog.com',
  flushAt: 1,
  flushInterval: 0,
})

const analytics = instrument(posthog, { cli: { name: 'acme', version: '1.4.2' } })

const command = analytics.command('deploy', { subcommand: 'prod', flags: ['--force'] })
try {
  await runDeploy()
  command.finish({ exitCode: 0 })
} catch (error) {
  command.finish({ exitCode: 1, error })
  throw error
} finally {
  await analytics.shutdown() // flushes queued events — never do this in process.on('exit')
}
```

### Commander

```ts
import { instrumentCommander } from '@posthog/cli-analytics/commander'

instrumentCommander(program, analytics, {
  intentFrom: (cmd) => cmd.opts().intent, // optional --intent flag
})
await program.parseAsync()
await analytics.shutdown()
```

## Agent detection

Every event carries `$cli_is_agent`, `$cli_agent_name` (`claude_code`, `cursor`, `codex`, `gemini_cli`, …), and `$cli_agent_source`. Detection is precision-first: a named env var (`CLAUDECODE`, `CURSOR_AGENT`, `CODEX_SANDBOX`, `AGENT=goose`, …) sets `source: 'env_var'`. CI and TTY are captured separately (`$cli_is_ci`, `$cli_is_tty`) so you can build your own heuristics downstream. You can also call `detectAgent()` standalone.

## Privacy & consent

- Honors `DO_NOT_TRACK` and `POSTHOG_CLI_TELEMETRY_DISABLED` — either disables capture, enforced at a single chokepoint so no event can slip through.
- `POSTHOG_CLI_TELEMETRY_DEBUG=1` prints each event to **stderr** and sends nothing — the transparency mode.
- Identity defaults to a persisted, machine-local anonymous id with person processing off, so anonymous installs don't inflate person counts. Call `instrument(posthog, { identify })` to attach a real user.
- `instrument(posthog, { enabled: false })` force-disables in code.

## Events

| Event | When |
| --- | --- |
| `$cli_command_run` | one per command invocation (duration, exit code, flags, intent, agent) |
| `$exception` | sibling of a failed command run (opt-out via the client) |
| `$cli_custom` / your name | `analytics.track('feedback_submitted', { rating: 5 })` |

See `src/extensions/constants.ts` for the full property schema.
