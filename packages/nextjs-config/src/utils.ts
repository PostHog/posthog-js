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
  // Snapshot the compiler output before invoking the CLI. Next.js 16.3+
  // Turbopack can continue flushing its filesystem cache after
  // runAfterProductionCompile starts. Passing the directory lets the CLI scan
  // once while injecting and again while uploading, so a chunk created between
  // those scans has no injected chunk id and aborts the build. Feeding the CLI
  // an explicit file list makes both phases operate on the same immutable set.
  const filePaths = await listJavaScriptFiles(directory)
  if (filePaths.length === 0) {
    return
  }
  await runSourcemapCli(posthogOptions, { filePaths })
}

async function listJavaScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  await visit(directory, files)
  return files.sort()
}

async function visit(directory: string, files: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await visit(fullPath, files)
    } else if (entry.isFile() && /\.[mc]?js$/.test(entry.name)) {
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
