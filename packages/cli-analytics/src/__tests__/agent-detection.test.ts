import { detectAgent, detectCi } from '../extensions/agent-detection'
import type { AgentInfo } from '../types'

describe('agent-detection', () => {
    describe('named agents via env vars', () => {
        const cases: Array<[string, Record<string, string>, AgentInfo]> = [
            [
                'Claude Code (CLAUDECODE)',
                { CLAUDECODE: '1' },
                { isAgent: true, agentName: 'claude_code', source: 'env_var' },
            ],
            [
                'Claude Code (entrypoint)',
                { CLAUDE_CODE_ENTRYPOINT: 'cli' },
                { isAgent: true, agentName: 'claude_code', source: 'env_var' },
            ],
            ['Cursor', { CURSOR_AGENT: '1' }, { isAgent: true, agentName: 'cursor', source: 'env_var' }],
            ['Codex', { CODEX_SANDBOX: 'seatbelt' }, { isAgent: true, agentName: 'codex', source: 'env_var' }],
            ['Gemini CLI', { GEMINI_CLI: '1' }, { isAgent: true, agentName: 'gemini_cli', source: 'env_var' }],
            ['Augment', { AUGMENT_AGENT: '1' }, { isAgent: true, agentName: 'augment', source: 'env_var' }],
            ['Cline', { CLINE_ACTIVE: 'true' }, { isAgent: true, agentName: 'cline', source: 'env_var' }],
            ['OpenCode', { OPENCODE_CLIENT: '1' }, { isAgent: true, agentName: 'opencode', source: 'env_var' }],
            ['Replit', { REPL_ID: 'abc' }, { isAgent: true, agentName: 'replit', source: 'env_var' }],
        ]

        it.each(cases)('detects %s', (_label, env, expected) => {
            expect(detectAgent(env, { isTty: true })).toEqual(expected)
        })
    })

    describe('generic AGENT / AI_AGENT', () => {
        it('uses a known value as the agent name', () => {
            expect(detectAgent({ AGENT: 'goose' })).toEqual({ isAgent: true, agentName: 'goose', source: 'env_var' })
            expect(detectAgent({ AGENT: 'amp' })).toEqual({ isAgent: true, agentName: 'amp', source: 'env_var' })
            expect(detectAgent({ AI_AGENT: 'devin' })).toEqual({ isAgent: true, agentName: 'devin', source: 'env_var' })
        })

        it('treats a bare flag value as an unnamed agent', () => {
            expect(detectAgent({ AGENT: '1' })).toEqual({ isAgent: true, source: 'env_var' })
            expect(detectAgent({ AI_AGENT: 'true' })).toEqual({ isAgent: true, source: 'env_var' })
        })

        it('ignores an unknown value but still flags an agent', () => {
            expect(detectAgent({ AGENT: 'some-internal-tool' })).toEqual({ isAgent: true, source: 'env_var' })
        })
    })

    describe('no agent', () => {
        it('returns isAgent false for an interactive human shell', () => {
            expect(detectAgent({ TERM: 'xterm-256color', SHELL: '/bin/zsh' }, { isTty: true })).toEqual({
                isAgent: false,
                source: null,
            })
        })

        it.each(['', '0', 'false'])('treats %p as not-set', (value) => {
            expect(detectAgent({ CLAUDECODE: value }, { isTty: true })).toEqual({ isAgent: false, source: null })
        })

        it('does not treat CI alone as an agent', () => {
            expect(detectAgent({ CI: 'true' }, { isTty: false })).toEqual({ isAgent: false, source: null })
        })
    })

    describe('heuristics (opt-in)', () => {
        it('does not fire heuristics by default', () => {
            expect(detectAgent({ TERM: 'dumb' }, { isTty: false })).toEqual({ isAgent: false, source: null })
        })

        it('flags TERM=dumb as a heuristic agent when enabled', () => {
            expect(detectAgent({ TERM: 'dumb' }, { isTty: false, includeHeuristics: true })).toEqual({
                isAgent: true,
                source: 'heuristic',
            })
        })

        it('flags no-TTY + NO_COLOR as a heuristic agent when enabled', () => {
            expect(detectAgent({ NO_COLOR: '1' }, { isTty: false, includeHeuristics: true })).toEqual({
                isAgent: true,
                source: 'heuristic',
            })
        })

        it('named env vars win over heuristics', () => {
            expect(detectAgent({ CLAUDECODE: '1', TERM: 'dumb' }, { isTty: false, includeHeuristics: true })).toEqual({
                isAgent: true,
                agentName: 'claude_code',
                source: 'env_var',
            })
        })
    })

    describe('detectCi', () => {
        it.each(['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI'])('detects %s', (varName) => {
            expect(detectCi({ [varName]: 'true' })).toBe(true)
        })

        it('is false without CI markers', () => {
            expect(detectCi({ TERM: 'xterm' })).toBe(false)
        })
    })
})
