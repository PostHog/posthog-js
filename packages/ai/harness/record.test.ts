import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('initializes the recording CLI before attempting provider traffic', () => {
  const blockNetwork = `globalThis.fetch = async () => { throw new Error('RECORDING_NETWORK_BLOCKED') }`
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(blockNetwork)}`,
      fileURLToPath(new URL('./record.mjs', import.meta.url)),
      'anthropic-stream',
    ],
    {
      env: { ANTHROPIC_API_KEY: 'fake-recording-key', ANTHROPIC_MODEL: 'synthetic-model' },
      encoding: 'utf8',
      timeout: 5000,
    }
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('RECORDING_NETWORK_BLOCKED')
  expect(result.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
})
