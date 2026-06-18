import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { newPrefixedId } from './ids'
import { log } from './logger'

interface PersistedIdentity {
    anonymousId: string
    /** Local-only salt for one-way project hashing. NEVER transmitted. */
    salt: string
}

export interface IdentityStore {
    /** A stable, machine-local anonymous distinct id. Persisted across runs. */
    anonymousId: string
    /**
     * One-way hash a stable project identifier (e.g. a git remote URL) into an
     * anonymous, non-reversible id using the locally-stored salt. The salt never
     * leaves the machine, so the raw input can't be recovered from the output.
     */
    hashProject(rawProjectId: string): string
}

/** Resolve the per-user config directory in an OS-appropriate, dependency-free way. */
function configDir(): string {
    if (process.platform === 'win32') {
        return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    }
    return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}

function configPath(cliName: string): string {
    const safeName = cliName.replace(/[^a-zA-Z0-9_-]+/g, '-')
    return join(configDir(), 'posthog', `${safeName}.cli-analytics.json`)
}

function readPersisted(path: string): PersistedIdentity | null {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedIdentity>
        if (typeof parsed.anonymousId === 'string' && typeof parsed.salt === 'string') {
            return { anonymousId: parsed.anonymousId, salt: parsed.salt }
        }
    } catch {
        // Missing/corrupt file — fall through to mint a new identity.
    }
    return null
}

function writePersisted(path: string, identity: PersistedIdentity): void {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(identity), { encoding: 'utf8', mode: 0o600 })
}

function buildStore(identity: PersistedIdentity): IdentityStore {
    return {
        anonymousId: identity.anonymousId,
        hashProject(rawProjectId: string): string {
            return createHash('sha256').update(identity.salt).update(rawProjectId).digest('hex')
        },
    }
}

/**
 * Loads the machine-local anonymous identity for a CLI, minting and persisting
 * one on first run. Identity is namespaced by CLI name so different PostHog CLIs
 * don't share an id. Degrades gracefully: if the config file can't be read or
 * written (read-only FS, sandbox, perms), returns an ephemeral in-memory
 * identity so capture still works — only persistence is lost.
 */
export function resolveIdentity(cliName: string): IdentityStore {
    const path = configPath(cliName)

    const existing = readPersisted(path)
    if (existing) {
        return buildStore(existing)
    }

    const fresh: PersistedIdentity = {
        anonymousId: newPrefixedId('anon'),
        salt: randomBytes(16).toString('hex'),
    }

    try {
        writePersisted(path, fresh)
    } catch (error) {
        log(`Could not persist anonymous identity (${error}); using an ephemeral id for this run.`)
    }

    return buildStore(fresh)
}
