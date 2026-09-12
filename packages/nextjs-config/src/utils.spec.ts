import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runSourcemapCli } from '@posthog/plugin-utils'
import type { ResolvedPluginConfig } from '@posthog/webpack-plugin'

import { processSourceMaps } from './utils'

jest.mock('@posthog/plugin-utils', () => ({
  runSourcemapCli: jest.fn(),
}))

const mockedRunSourcemapCli = runSourcemapCli as jest.MockedFunction<typeof runSourcemapCli>
const posthogOptions = {} as ResolvedPluginConfig

describe('processSourceMaps', () => {
  let distDir: string

  beforeEach(async () => {
    mockedRunSourcemapCli.mockReset()
    distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-nextjs-config-utils-'))
  })

  afterEach(async () => {
    await fs.rm(distDir, { recursive: true, force: true })
  })

  async function writeFile(relativePath: string, content = ''): Promise<string> {
    const fullPath = path.join(distDir, relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
    return fullPath
  }

  it('passes an explicit snapshot of JavaScript files to the sourcemap CLI', async () => {
    const js = await writeFile('static/chunks/a.js')
    const mjs = await writeFile('server/app/b.mjs')
    const cjs = await writeFile('server/c.cjs')
    await writeFile('static/chunks/a.js.map', '{}')
    await writeFile('BUILD_ID', 'build-id')

    await processSourceMaps(posthogOptions, distDir)

    expect(mockedRunSourcemapCli).toHaveBeenCalledTimes(1)
    expect(mockedRunSourcemapCli).toHaveBeenCalledWith(posthogOptions, {
      filePaths: [cjs, mjs, js].sort(),
    })
  })

  it('does not let files created during CLI processing enter the same run', async () => {
    const initial = await writeFile('static/chunks/initial.js')
    let late: string | undefined
    mockedRunSourcemapCli.mockImplementationOnce(async () => {
      late = await writeFile('static/chunks/late.js')
    })

    await processSourceMaps(posthogOptions, distDir)

    expect(mockedRunSourcemapCli).toHaveBeenCalledWith(posthogOptions, { filePaths: [initial] })
    expect(late).toBeDefined()
    expect(mockedRunSourcemapCli.mock.calls[0]?.[1]).not.toEqual({ filePaths: [initial, late] })
  })

  it('skips the CLI when the output directory contains no JavaScript files', async () => {
    await writeFile('static/chunks/page.js.map', '{}')

    await processSourceMaps(posthogOptions, distDir)

    expect(mockedRunSourcemapCli).not.toHaveBeenCalled()
  })

  it('treats a missing output directory as an empty snapshot', async () => {
    await fs.rm(distDir, { recursive: true, force: true })

    await processSourceMaps(posthogOptions, distDir)

    expect(mockedRunSourcemapCli).not.toHaveBeenCalled()
  })
})
