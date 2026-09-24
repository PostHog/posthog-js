import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { WorkflowError } from '../errors.js'

const DEFAULT_HOST = 'https://us.posthog.com'

export interface Credentials {
    readonly apiKey: string
    readonly projectId: string
    readonly host: string
    readonly source: string
}

interface CredentialsFile {
    readonly host?: string | null
    readonly token?: string
    readonly env_id?: string
}

function credentialsPath(env: Readonly<Record<string, string | undefined>>, homeDir: string): string {
    const home = env.POSTHOG_HOME
    return home === undefined || home === ''
        ? join(homeDir, '.posthog', 'credentials.json')
        : join(home, 'credentials.json')
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertCredentialsFile(value: unknown, path: string): CredentialsFile {
    if (
        isObject(value) &&
        (value.host === undefined || value.host === null || typeof value.host === 'string') &&
        (value.token === undefined || typeof value.token === 'string') &&
        (value.env_id === undefined || typeof value.env_id === 'string')
    ) {
        return value
    }
    throw new WorkflowError({
        status: 'invalid_credentials_file',
        message: `Could not read ${path}.`,
        why: 'The credentials file must contain string fields named token and env_id, and an optional string host.',
        fix: 'Run posthog-cli login again, or fix the credentials file before you run this command.',
    })
}

function readFile(path: string, shownPath: string): CredentialsFile | null {
    let raw: string
    try {
        raw = readFileSync(path, 'utf8')
    } catch {
        return null
    }
    try {
        return assertCredentialsFile(JSON.parse(raw) as unknown, shownPath)
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new WorkflowError({
                status: 'invalid_credentials_file',
                message: `Could not read ${shownPath}.`,
                why: 'The credentials file is not valid JSON.',
                fix: 'Run posthog-cli login again, or fix the credentials file before you run this command.',
            })
        }
        throw error
    }
}

function shown(path: string, homeDir: string): string {
    return path.startsWith(homeDir) ? `~${path.slice(homeDir.length)}` : path
}

export interface CredentialOverrides {
    readonly project?: string | undefined
    readonly host?: string | undefined
}

export function assertProjectId(value: string, source: string): string {
    if (/^[0-9]+$/.test(value)) {
        return value
    }
    throw new WorkflowError({
        status: 'invalid_project',
        message: `${source} must be an ASCII decimal number.`,
        why: `The project ID must contain only the digits 0 through 9, and "${value}" contains something else.`,
        fix: 'Use the numeric project ID from PostHog, for example 2.',
    })
}

function validatedProject(value: string | undefined, source: string): string | undefined {
    return value === undefined ? undefined : assertProjectId(value, source)
}

function present(value: string | null | undefined): value is string {
    return value !== undefined && value !== null && value !== ''
}

function firstPresent(...values: readonly (string | null | undefined)[]): string | undefined {
    return values.find(present)
}

function trimHost(host: string | null | undefined): string | undefined {
    return present(host) ? host.replace(/\/+$/, '') : undefined
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function assertSecureHost(host: string, source: string): string {
    let url: URL
    try {
        url = new URL(host)
    } catch {
        throw new WorkflowError({
            status: 'invalid_host',
            message: `"${host}" is not a URL.`,
            why: `The host from ${source} has to be a full URL, with its scheme, for the CLI to send requests to it.`,
            fix: 'Use the form https://us.posthog.com, or https://eu.posthog.com for PostHog Cloud EU.',
        })
    }
    if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) {
        throw new WorkflowError({
            status: 'insecure_host',
            message: `${host} is not an https URL.`,
            why: `Every request sends the API key as a bearer token, so a plain-HTTP host outside this machine would send the key in clear text. The host came from ${source}.`,
            fix: 'Use https for a remote PostHog. Plain http is only allowed for localhost, 127.0.0.1 and [::1].',
        })
    }
    return host
}

function secureHost(host: string | null | undefined, source: string): string | undefined {
    const trimmed = trimHost(host)
    return trimmed === undefined ? undefined : assertSecureHost(trimmed, source)
}

function describeSource(base: string, overrides: CredentialOverrides): string {
    const parts = [base]
    if (overrides.project !== undefined) {
        parts.push('project from --project')
    }
    if (overrides.host !== undefined) {
        parts.push('host from --host')
    }
    return parts.join(', ')
}

export function resolveCredentials(
    env: Readonly<Record<string, string | undefined>>,
    homeDir: string,
    overrides: CredentialOverrides = {}
): Credentials | null {
    const host = (): string | undefined =>
        secureHost(overrides.host, '--host') ?? secureHost(env.POSTHOG_CLI_HOST, 'POSTHOG_CLI_HOST')
    const apiKey = firstPresent(env.POSTHOG_CLI_API_KEY, env.POSTHOG_CLI_TOKEN)
    const projectId =
        validatedProject(overrides.project, '--project') ??
        validatedProject(env.POSTHOG_CLI_PROJECT_ID, 'POSTHOG_CLI_PROJECT_ID') ??
        validatedProject(env.POSTHOG_CLI_ENV_ID, 'POSTHOG_CLI_ENV_ID')

    if (apiKey !== undefined && projectId !== undefined) {
        return { apiKey, projectId, host: host() ?? DEFAULT_HOST, source: describeSource('the environment', overrides) }
    }

    const path = credentialsPath(env, homeDir)
    const shownPath = shown(path, homeDir)
    const file = readFile(path, shownPath)
    const fileProjectId = validatedProject(overrides.project, '--project') ?? validatedProject(file?.env_id, 'env_id')
    if (present(file?.token) && fileProjectId !== undefined) {
        return {
            apiKey: file.token,
            projectId: fileProjectId,
            host: host() ?? secureHost(file.host, shownPath) ?? DEFAULT_HOST,
            source: describeSource(shownPath, overrides),
        }
    }
    return null
}

export function requireCredentials(
    env: Readonly<Record<string, string | undefined>>,
    homeDir: string,
    overrides: CredentialOverrides = {}
): Credentials {
    const credentials = resolveCredentials(env, homeDir, overrides)
    if (credentials !== null) {
        return credentials
    }
    throw new WorkflowError({
        status: 'missing_credentials',
        message: 'No PostHog credentials.',
        why: `push writes to a project, so it needs an API key with hog_flow:write and the project to write into. Neither the environment nor ${shown(credentialsPath(env, homeDir), homeDir)} carried both.`,
        fix: 'In CI set POSTHOG_CLI_API_KEY, POSTHOG_CLI_PROJECT_ID and POSTHOG_CLI_HOST, or set the key and pass --project. On your own machine run posthog-cli login once.',
    })
}
