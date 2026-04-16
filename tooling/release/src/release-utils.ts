import fs from 'node:fs/promises'
import path from 'node:path'

export type FlatStringMap = Record<string, string>

export type VersionEntry = {
    version: string
    timestamp?: string
    yanked?: boolean
    [key: string]: unknown
}

export type Semver = {
    major: number
    minor: number
    patch: number
    prerelease?: string
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function assertEnv(name: string): string {
    const value = process.env[name]
    if (!value) {
        throw new Error(`${name} is required`)
    }
    return value
}

export function parseSemver(version: string): Semver | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/)
    if (!match) {
        return null
    }

    const [, major, minor, patch, prerelease] = match
    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        prerelease,
    }
}

export function parseStableSemver(version: string): Semver | null {
    const parsed = parseSemver(version)
    return parsed && !parsed.prerelease ? parsed : null
}

export function isFlatStringMap(value: unknown): value is FlatStringMap {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string')
}

export function assertFlatStringMap(value: unknown, label: string): FlatStringMap {
    if (!isFlatStringMap(value)) {
        throw new Error(`${label} must be a flat string map`)
    }
    return value
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJson)
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, sortJson(item)])
        )
    }

    return value
}

export function toCanonicalJsonString(value: unknown): string {
    return JSON.stringify(sortJson(value))
}

export function generateManifestFromVersions(entries: VersionEntry[]): FlatStringMap {
    const stableVersions = entries
        .filter((entry) => !entry.yanked)
        .map((entry) => ({ version: entry.version, parsed: parseStableSemver(entry.version) }))
        .filter((entry): entry is { version: string; parsed: Semver } => !!entry.parsed)
        .sort((left, right) => {
            return (
                left.parsed.major - right.parsed.major ||
                left.parsed.minor - right.parsed.minor ||
                left.parsed.patch - right.parsed.patch
            )
        })

    const manifest: FlatStringMap = {}
    for (const entry of stableVersions) {
        const majorKey = `${entry.parsed.major}`
        const majorMinorKey = `${entry.parsed.major}.${entry.parsed.minor}`
        manifest[majorKey] = entry.version
        manifest[majorMinorKey] = entry.version
    }

    return manifest
}

export function assertVersionEntries(value: unknown, label: string): VersionEntry[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`)
    }

    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || typeof (entry as VersionEntry).version !== 'string') {
            throw new Error(`${label} entries must be objects with a string version field`)
        }

        if (
            'timestamp' in entry &&
            (entry as VersionEntry).timestamp !== undefined &&
            typeof (entry as VersionEntry).timestamp !== 'string'
        ) {
            throw new Error(`${label} timestamp fields must be strings when present`)
        }
    }

    return value as VersionEntry[]
}

export function getManifestKvKey(): string {
    return 'manifest'
}

