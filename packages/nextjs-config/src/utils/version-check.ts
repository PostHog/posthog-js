import * as fs from 'fs'
import * as path from 'path'
import semver from 'semver'

// Helper to clean version strings by removing leading prefixes
export function cleanVersion(version: string): string {
  return version.replace(/^[^0-9]*/, '').trim()
}

// Helper to get Next.js version from package.json
export function getNextJsVersion(): string | null {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

    // Check for Next.js in dependencies or devDependencies
    const nextVersion = packageJson.dependencies?.next || packageJson.devDependencies?.next

    // If Next.js is not found in package.json
    if (!nextVersion) {
      return null
    }

    // Return the raw version string (could be a git URL, file path, etc.)
    return nextVersion
  } catch {
    // If we can't read package.json
    return null
  }
}

// Helper to check if a Next.js version supports runAfterProductionCompile
export function doesVersionSupportHook(versionString: string): { parseable: boolean; supportsHook: boolean } {
  // Remove common prefixes like ^, ~, >=, etc.
  const cleanedVersion = cleanVersion(versionString)

  // Handle special cases like "latest", "next", "canary", etc.
  if (['latest', 'next', 'canary', 'experimental'].includes(cleanedVersion.toLowerCase())) {
    // These tags typically point to the latest versions which likely support the hook
    // We can't parse the exact version, but we'll assume they support it
    return { parseable: false, supportsHook: true }
  }

  // Handle git URLs, file paths, npm aliases
  if (
    cleanedVersion.includes(':') ||
    cleanedVersion.includes('/') ||
    cleanedVersion.startsWith('file:') ||
    cleanedVersion.startsWith('link:')
  ) {
    // These are not parseable as semantic versions
    return { parseable: false, supportsHook: false }
  }

  // Parse semantic version
  const parsedVersion = semver.parse(cleanedVersion)
  if (!parsedVersion) {
    return { parseable: false, supportsHook: false }
  }

  // runAfterProductionCompile was introduced in Next.js 15.4.0-canary.19
  const supportsHook = semver.gte(parsedVersion, '15.4.0-canary.19')

  return { parseable: true, supportsHook }
}

// Combined helper to check Next.js version and warn if unsupported
export function checkNextJsVersionAndWarn(): boolean {
  const version = getNextJsVersion()

  if (!version) {
    // Next.js not found in package.json
    console.warn(
      'PostHog: Could not find Next.js in package.json. ' +
        'Sourcemap uploading with Turbopack requires Next.js 15.4.0 or above.'
    )
    return false
  }

  const { parseable, supportsHook } = doesVersionSupportHook(version)

  if (!supportsHook) {
    if (!parseable) {
      // Next.js found but version cannot be parsed (e.g., git URL, local link, etc.)
      console.warn(
        `PostHog: Could not determine Next.js version from "${version}". ` +
          'Sourcemap uploading with Turbopack requires Next.js 15.4.0 or above. ' +
          'The runAfterProductionCompile hook may not be available.'
      )
    } else {
      // Version is parseable but doesn't support the hook
      const cleanedVersion = cleanVersion(version)
      console.warn(
        `PostHog: Sourcemap uploading with Turbopack requires Next.js 15.4.0 or above (found: ${cleanedVersion}). ` +
          'The runAfterProductionCompile hook is not available in this version.'
      )
    }
  }

  return supportsHook
}
