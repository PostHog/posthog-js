import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runSourcemapCli } from '@posthog/plugin-utils'
import type { ResolvedPluginConfig } from '@posthog/webpack-plugin'

import { collectDistFiles, processSourceMaps } from './utils'

jest.mock('@posthog/plugin-utils', () => ({
  runSourcemapCli: jest.fn().mockResolvedValue(undefined),
}))

describe('collectDistFiles', () => {
  let distDir: string

  beforeEach(async () => {
    distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-nextjs-config-'))
  })

  afterEach(async () => {
    await fs.rm(distDir, { recursive: true, force: true })
  })

  async function writeFile(relativePath: string): Promise<string> {
    const fullPath = path.join(distDir, relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, '')
    return fullPath
  }

  it('collects files recursively, excluding the top-level cache directory', async () => {
    const chunk = await writeFile('static/chunks/page.js')
    const map = await writeFile('static/chunks/page.js.map')
    const buildId = await writeFile('BUILD_ID')
    // A route directory that happens to be named `cache` is build output, not
    // a bundler cache, and must stay included.
    const nestedCacheRoute = await writeFile('server/app/cache/route.js')
    await writeFile('cache/turbopack/blob.js')
    await writeFile('cache/webpack/index.pack')

    const files = await collectDistFiles(distDir)

    expect(files.sort()).toEqual([buildId, nestedCacheRoute, chunk, map].sort())
  })

  it('passes the snapshot as an explicit file list to the CLI', async () => {
    const chunk = await writeFile('static/chunks/page.js')
    await writeFile('cache/turbopack/blob.js')
    const config = {} as ResolvedPluginConfig

    await processSourceMaps(config, distDir)

    expect(runSourcemapCli).toHaveBeenCalledWith(config, { filePaths: [chunk] })
  })
})
