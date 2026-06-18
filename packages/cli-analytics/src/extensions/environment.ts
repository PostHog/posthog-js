import { arch, platform } from 'node:os'
import type { EnvironmentInfo } from '../types'
import { detectCi } from './agent-detection'

type EnvLike = Record<string, string | undefined>

/**
 * Collects coarse, non-identifying runtime facts stamped on every event: OS,
 * CPU architecture, runtime version, and whether the process is interactive (TTY)
 * or running in CI. Deliberately excludes anything that could identify a machine
 * or user (hostname, username, paths).
 */
export function collectEnvironment(env: EnvLike = process.env, isTty?: boolean): EnvironmentInfo {
    return {
        os: platform(),
        arch: arch(),
        runtime: runtimeLabel(),
        isTty: isTty ?? Boolean(process.stdout?.isTTY),
        isCi: detectCi(env),
    }
}

/** A `name/version` label for the JS runtime (e.g. `node/20.11.0`, `bun/1.1.0`). */
function runtimeLabel(): string {
    const versions = process.versions ?? {}
    if (typeof versions.bun === 'string') {
        return `bun/${versions.bun}`
    }
    if (typeof versions.deno === 'string') {
        return `deno/${versions.deno}`
    }
    return `node/${versions.node ?? 'unknown'}`
}
