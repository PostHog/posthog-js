export type Semver = {
    major: number
    minor: number
    patch: number
    prerelease?: string
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
