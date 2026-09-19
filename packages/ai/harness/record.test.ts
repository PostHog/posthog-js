import { execFile, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.each(['anthropic-stream', 'anthropic-cache', 'anthropic-tools'])(
  'initializes %s and hides untrusted transport errors',
  (group) => {
    const blockNetwork = `globalThis.fetch = async () => { throw new Error('RECORDING_NETWORK_BLOCKED fake-recording-key') }`
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(blockNetwork)}`,
        fileURLToPath(new URL('./record.mjs', import.meta.url)),
        group,
      ],
      {
        env: { ANTHROPIC_API_KEY: 'fake-recording-key', ANTHROPIC_MODEL: 'synthetic-model' },
        encoding: 'utf8',
        timeout: 5000,
      }
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Recording failed.')
    expect(result.stderr).not.toContain('RECORDING_NETWORK_BLOCKED')
    expect(result.stderr).not.toContain('fake-recording-key')
    expect(result.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
  }
)

it.each([false, true])('validates the CLI cache sequence before saving (invalid state: %s)', async (invalid) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-cache-cli-'))
  try {
    for (const name of ['record.mjs', 'cassette.ts', 'recording-scenarios.mjs', 'fixtures']) {
      await cp(new URL(name, import.meta.url), join(directory, name), {
        recursive: true,
        filter: (source) => !source.endsWith('.live.json'),
      })
    }
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir')
    const names = [
      'cache-5m-write',
      'cache-5m-hit',
      'cache-5m-extend',
      'cache-1h-write',
      'cache-1h-hit',
      'cache-1h-extend',
      'cache-mixed-write',
      'cache-mixed-hit',
      'cache-mixed-extend',
      'cache-below-minimum',
      'max-tokens',
    ]
    const firstRecording = join(directory, 'fixtures', 'anthropic-cache-5m-write.live.json')
    if (invalid) await writeFile(firstRecording, 'previous recording')
    const intercept = `
      import { readFileSync } from 'node:fs';
      const names = ${JSON.stringify(names)};
      const realFetch = globalThis.fetch;
      let index = 0;
      globalThis.fetch = async (url, init) => {
        const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
        if (target.origin === 'https://api.anthropic.com') {
          const file = ${JSON.stringify(directory)} + '/fixtures/anthropic-' + names[index++] + '.json';
          const fixture = JSON.parse(readFileSync(file, 'utf8'));
          let body = fixture.interactions[0].response.body.chunks.join('');
          if (${invalid}) body = body.replace(/"cache_read_input_tokens":\\s*0/g, '"cache_read_input_tokens":1');
          return new Response(body, {
            headers: { 'content-type': 'text/event-stream' }
          });
        }
        if (target.hostname !== '127.0.0.1') throw new Error('Unexpected network request');
        return realFetch(url, init);
      };
    `
    const execution = promisify(execFile)(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(intercept)}`,
        join(directory, 'record.mjs'),
        'anthropic-cache',
      ],
      { env: { ANTHROPIC_API_KEY: 'fake-recording-key', ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001' }, timeout: 10000 }
    )
    if (invalid) {
      await expect(execution).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Recording failed.'),
      })
      expect(await readFile(firstRecording, 'utf8')).toBe('previous recording')
      await expect(readFile(join(directory, 'fixtures', 'anthropic-cache-5m-hit.live.json'))).rejects.toThrow()
      return
    }
    const result = await execution
    expect(result.stdout.match(/verified SDK replay/g)).toHaveLength(11)
    for (const name of names) {
      const saved = await readFile(join(directory, 'fixtures', `anthropic-${name}.live.json`), 'utf8')
      expect(saved).not.toContain('fake-recording-key')
      expect(JSON.parse(saved).interactions).toHaveLength(1)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([false, true])('validates tool arguments before CLI publication (wrong arguments: %s)', async (invalid) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tools-cli-'))
  try {
    for (const name of ['record.mjs', 'cassette.ts', 'recording-scenarios.mjs']) {
      await cp(new URL(name, import.meta.url), join(directory, name))
    }
    await mkdir(join(directory, 'fixtures'))
    const fixture = JSON.parse(await readFile(new URL('./fixtures/anthropic-tools.json', import.meta.url), 'utf8'))
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir')
    const path = join(directory, 'fixtures', 'anthropic-tools.live.json')
    await writeFile(path, 'previous recording')
    const body = fixture.interactions[0].response.body.chunks.join('')
    // The live recording splits Paris into "Pari" and "s" deltas.
    const wrongArguments = body.replace('Pari', 'Tour')
    expect(wrongArguments).not.toBe(body)
    const intercept = `
      const realFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
        if (target.origin === 'https://api.anthropic.com') {
          if (++calls !== 1) throw new Error('Unexpected extra provider request');
          const request = JSON.parse(init.body);
          if (request.tool_choice?.name !== 'get_weather') throw new Error('Missing forced tool');
          return new Response(${JSON.stringify(invalid ? wrongArguments : body)}, {
            headers: { 'content-type': 'text/event-stream' }
          });
        }
        if (target.hostname !== '127.0.0.1') throw new Error('Unexpected network request');
        return realFetch(url, init);
      };
    `
    const execution = promisify(execFile)(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(intercept)}`,
        join(directory, 'record.mjs'),
        'anthropic-tools',
      ],
      { env: { ANTHROPIC_API_KEY: 'fake-recording-key', ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001' }, timeout: 10000 }
    )
    if (invalid) {
      await expect(execution).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('Recording failed.'),
      })
      expect(await readFile(path, 'utf8')).toBe('previous recording')
      return
    }
    const result = await execution
    expect(result.stdout.match(/verified SDK replay/g)).toHaveLength(1)
    const saved = await readFile(path, 'utf8')
    expect(saved).not.toContain('fake-recording-key')
    const cassette = JSON.parse(saved)
    expect(cassette.interactions).toHaveLength(1)
    expect(cassette.interactions[0].response.body.chunks).toEqual(fixture.interactions[0].response.body.chunks)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
