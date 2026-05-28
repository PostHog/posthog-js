/**
 * `@posthog/mcp` package entry. The full SDK lands in the follow-up
 * implementation PR. This commit only contains the package scaffolding so the
 * monorepo wiring (build, lint, tests, release matrix) can be reviewed in
 * isolation from the actual SDK code.
 */

import { version } from './version'

export { version }
