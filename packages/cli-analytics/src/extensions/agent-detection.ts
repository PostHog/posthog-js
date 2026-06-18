import type { AgentInfo } from '../types'

type EnvLike = Record<string, string | undefined>

/**
 * Named-agent signatures, checked in order — first match wins. Each agent is
 * identified by one or more env vars it is known to set. Presence + truthiness
 * is enough (most set `=1`/`=true`); we don't assert a specific value so a
 * version bump that changes the value doesn't silently stop detection.
 *
 * This table is the part that churns as the agent ecosystem moves — keep it
 * small, sorted by specificity, and exhaustively unit-tested.
 */
const NAMED_AGENT_SIGNATURES: ReadonlyArray<{ name: string; vars: readonly string[] }> = [
    { name: 'claude_code', vars: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] },
    { name: 'cursor', vars: ['CURSOR_AGENT', 'CURSOR_TRACE_ID'] },
    { name: 'codex', vars: ['CODEX_SANDBOX', 'CODEX_CI'] },
    { name: 'gemini_cli', vars: ['GEMINI_CLI'] },
    { name: 'augment', vars: ['AUGMENT_AGENT'] },
    { name: 'cline', vars: ['CLINE_ACTIVE'] },
    { name: 'opencode', vars: ['OPENCODE_CLIENT', 'OPENCODE'] },
    { name: 'replit', vars: ['REPL_ID'] },
]

/**
 * Values of the generic `AGENT` / `AI_AGENT` env var that name a specific agent
 * rather than just signalling "an agent" (e.g. `AGENT=amp`, `AGENT=goose`).
 */
const GENERIC_AGENT_VARS = ['AI_AGENT', 'AGENT'] as const
const KNOWN_GENERIC_AGENT_NAMES = new Set(['amp', 'goose', 'aider', 'devin', 'windsurf', 'cline', 'cursor'])

/** Env var whose presence indicates a CI runner — captured separately from agent. */
const CI_ENV_VARS = ['CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI'] as const

export interface DetectAgentOptions {
    /** Whether the process is attached to an interactive terminal. Defaults to `process.stdout.isTTY`. */
    isTty?: boolean
    /**
     * Also apply non-interactive heuristics (TERM=dumb, no-TTY + NO_COLOR) when no
     * named agent is found. Off by default: these signals also fire for CI jobs
     * and humans piping output, so enabling them trades precision for recall on
     * the headline `is_agent` metric. CI/TTY are always captured separately, so
     * prefer building heuristics downstream over flipping this on.
     */
    includeHeuristics?: boolean
}

function isTruthy(value: string | undefined): boolean {
    if (value === undefined) {
        return false
    }
    const normalized = value.trim().toLowerCase()
    return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

function normalizeAgentName(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

/** Whether any CI env var is set. Surfaced as `$cli_is_ci`, not folded into agent detection. */
export function detectCi(env: EnvLike = process.env): boolean {
    return CI_ENV_VARS.some((name) => isTruthy(env[name]))
}

function detectNamedAgent(env: EnvLike): AgentInfo | null {
    for (const signature of NAMED_AGENT_SIGNATURES) {
        if (signature.vars.some((name) => isTruthy(env[name]))) {
            return { isAgent: true, agentName: signature.name, source: 'env_var' }
        }
    }

    for (const varName of GENERIC_AGENT_VARS) {
        const value = env[varName]
        if (!isTruthy(value)) {
            continue
        }
        const normalized = normalizeAgentName(value as string)
        const isBareFlag = normalized === '1' || normalized === 'true' || normalized === ''
        const agentName = !isBareFlag && KNOWN_GENERIC_AGENT_NAMES.has(normalized) ? normalized : undefined
        return { isAgent: true, agentName, source: 'env_var' }
    }

    return null
}

function detectHeuristicAgent(env: EnvLike, isTty: boolean): AgentInfo | null {
    // TERM=dumb is a fairly specific non-interactive marker; agents set it to
    // suppress ANSI control sequences. A no-TTY process that also suppresses
    // color is another (weaker) non-interactive shape.
    const termIsDumb = (env.TERM ?? '').trim().toLowerCase() === 'dumb'
    const noColorNonInteractive = !isTty && isTruthy(env.NO_COLOR)
    if (termIsDumb || noColorNonInteractive) {
        return { isAgent: true, source: 'heuristic' }
    }
    return null
}

/**
 * Determines whether an AI agent (Claude Code, Cursor, Codex, …) — rather than a
 * human — is driving the CLI, and which agent when identifiable.
 *
 * Detection is precision-first: a named env-var match returns the agent name
 * with `source: 'env_var'`. Non-interactive heuristics are opt-in
 * ({@link DetectAgentOptions.includeHeuristics}) because they also fire for CI
 * and piped human use.
 *
 * Pure and deterministic given its inputs — pass `env`/`isTty` explicitly in
 * tests. Returns `{ isAgent: false, source: null }` when nothing matches.
 *
 * @example
 * ```ts
 * detectAgent({ CLAUDECODE: '1' }) // → { isAgent: true, agentName: 'claude_code', source: 'env_var' }
 * detectAgent({ AGENT: 'goose' })  // → { isAgent: true, agentName: 'goose', source: 'env_var' }
 * detectAgent({})                  // → { isAgent: false, source: null }
 * ```
 */
export function detectAgent(env: EnvLike = process.env, options: DetectAgentOptions = {}): AgentInfo {
    const named = detectNamedAgent(env)
    if (named) {
        return named
    }

    if (options.includeHeuristics) {
        const isTty = options.isTty ?? Boolean(process.stdout?.isTTY)
        const heuristic = detectHeuristicAgent(env, isTty)
        if (heuristic) {
            return heuristic
        }
    }

    return { isAgent: false, source: null }
}
