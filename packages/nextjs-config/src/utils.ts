import fs from 'node:fs/promises'
import path from 'node:path'

import nextPackage from 'next/package.json' with { type: 'json' }
import semver from 'semver'

import { runSourcemapCli } from '@posthog/plugin-utils'
import { ResolvedPluginConfig } from '@posthog/webpack-plugin'

export function getNextJsVersion(): string {
  return nextPackage.version
}

export function hasCompilerHook(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '15.4.1')
}

export async function processSourceMaps(posthogOptions: ResolvedPluginConfig, directory: string) {
  await runSourcemapCli(posthogOptions, { filePaths: await collectDistFiles(directory) })
}

// Snapshot the build outputs into an explicit file list instead of handing the
// CLI a directory. The CLI's `process` command re-walks directory roots once
// for inject and again for upload, while Next.js 16.3+ (Turbopack filesystem
// cache) keeps writing into distDir in the background during
// runAfterProductionCompile — so the upload walk can find chunks the inject
// walk never stamped and abort the build with "Chunk ID not found". A frozen
// file list makes both passes see the same set.
// See https://github.com/PostHog/posthog-js/issues/4667
//
// The top-level `cache` directory only holds bundler caches (Turbopack
// filesystem cache, webpack cache), never deployable chunks, and is written
// concurrently by design — skip it. Deeper directories named `cache` are
// route output and stay included.
export async function collectDistFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  await collectFilesInto(directory, files, new Set(['cache']))
  return files
}

async function collectFilesInto(directory: string, files: string[], skipNames?: Set<string>): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    // A directory vanished or became unreadable mid-walk (the bundler writes
    // concurrently) — skip it rather than failing the build, matching the
    // CLI's own tolerant directory walker.
    return
  }
  for (const entry of entries) {
    if (skipNames?.has(entry.name)) {
      continue
    }
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectFilesInto(fullPath, files)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
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
