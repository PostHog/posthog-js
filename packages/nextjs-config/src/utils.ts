import nextPackage from 'next/package.json' with { type: 'json' }
import semver from 'semver'

import { resolveReleaseId as resolveReleaseIdWithCli, runSourcemapCli } from '@posthog/plugin-utils'
import type { SourcemapCliCommand } from '@posthog/plugin-utils'
import { ResolvedPluginConfig } from '@posthog/webpack-plugin'

export function getNextJsVersion(): string {
  return nextPackage.version
}

export function hasCompilerHook(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '15.4.1')
}

export async function processSourceMaps(
  posthogOptions: ResolvedPluginConfig,
  directory: string,
  command: SourcemapCliCommand = 'process',
  nativeDebugIds = false
) {
  await runSourcemapCli(posthogOptions, { directory, command, nativeDebugIds })
}

export async function resolveReleaseId(posthogOptions: ResolvedPluginConfig): Promise<string | undefined> {
  return resolveReleaseIdWithCli(posthogOptions)
}

export function supportsTurbopackDebugIds(): boolean {
  return semver.gte(getNextJsVersion(), '16.0.0')
}

// Helper to detect if Turbopack is enabled
export function isTurbopackEnabled(): boolean {
  // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
  return process.env.TURBOPACK === '1' || (isTurbopackDefault() && !(process.env.WEBPACK === '1'))
}

function isTurbopackDefault(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '16.0.0')
}
