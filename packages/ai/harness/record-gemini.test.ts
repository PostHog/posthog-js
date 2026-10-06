import { execFile, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('does not let the SDK text getter print an untrusted streamed part name', () => {
  const intercept = `
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const target = new URL(url);
      if (target.origin === 'https://generativelanguage.googleapis.com') {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{index:0,content:{parts:[{text:'Hi', 'fake-secret-part-name':'unexpected'}]},finishReason:'STOP'}]})+'\\n\\n'));
            setTimeout(() => controller.close(), 50);
          }
        }), {headers:{'content-type':'text/event-stream'}});
      }
      if (target.hostname !== '127.0.0.1') throw new Error('Unexpected network');
      return realFetch(url, init);
    };
  `
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(intercept)}`,
      fileURLToPath(new URL('./record-gemini.mjs', import.meta.url)),
      'stream',
    ],
    {
      env: { GEMINI_API_KEY: 'fake-secret-part-name', GEMINI_MODEL: 'synthetic-model' },
      encoding: 'utf8',
      timeout: 5000,
    }
  )
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Gemini recording failed.')
  expect(result.stderr + result.stdout).not.toContain('fake-secret-part-name')
})

it.each(['', 'fake-key\nmalformed', 'fake-key'])('fails safely without exposing credentials (%#)', (key) => {
  const intercept = `globalThis.fetch = async () => { throw new Error('NETWORK_BLOCKED ${key.replaceAll('\n', '')}') }`
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(intercept)}`,
      fileURLToPath(new URL('./record-gemini.mjs', import.meta.url)),
      'generate',
    ],
    {
      env: { GEMINI_API_KEY: key, GEMINI_MODEL: 'synthetic-model' },
      encoding: 'utf8',
      timeout: 5000,
    }
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Gemini recording failed.')
  expect(result.stderr).not.toContain('NETWORK_BLOCKED')
  expect(result.stderr).not.toContain('fake-key')
  expect(result.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
})

it.each([
  'generate',
  'stream',
  'tools',
  'tools-stream',
  'embed',
  'interaction',
  'interaction-stream',
  'interaction-tools',
  'interaction-tools-stream',
])('records and replays the %s CLI with synthetic upstream responses', async (group) => {
  const directory = await mkdtemp(join(tmpdir(), 'gemini-cli-'))
  try {
    for (const name of [
      'record-gemini.mjs',
      'gemini-scenarios.mjs',
      'cassette.ts',
      'gemini-protocol.ts',
      'gemini-interactions-protocol.ts',
      'openai-protocol.ts',
    ]) {
      await cp(new URL(name, import.meta.url), join(directory, name))
    }
    await mkdir(join(directory, 'fixtures'))
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir')
    const intercept = `
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
        if (target.origin === 'https://generativelanguage.googleapis.com') {
          const request = JSON.parse(init.body);
          if (target.pathname.endsWith('/interactions')) {
            const tools = Array.isArray(request.tools);
            const interaction = {
              id: 'v1_synthetic', model: request.model, status: tools ? 'requires_action' : 'completed',
              steps: tools
                ? [{type:'function_call',id:'call_synthetic',name:'describe_shape',arguments:{color:'blue',sides:3}}]
                : [{type:'model_output',content:[{type:'text',text:'Hello.'}]}],
              usage: {total_input_tokens:7,total_output_tokens:3,total_tokens:10},
            };
            if (!request.stream) return Response.json(interaction);
            const frame = (type, data) => 'event: '+type+'\\ndata: '+JSON.stringify({event_type:type,...data})+'\\n\\n';
            const step = interaction.steps[0];
            return new Response([
              frame('interaction.created',{interaction:{id:interaction.id,model:interaction.model,status:'in_progress'}}),
              frame('step.start',{index:0,step:tools ? {type:'function_call',id:step.id,name:step.name,arguments:{}} : {type:'model_output'}}),
              frame('step.delta',{index:0,delta:tools ? {type:'arguments_delta',arguments:JSON.stringify(step.arguments)} : {type:'text',text:'Hello.'}}),
              frame('step.stop',{index:0}),
              frame('interaction.completed',{interaction:{id:interaction.id,status:interaction.status,usage:interaction.usage}}),
              'event: done\\ndata: [DONE]\\n\\n',
            ].join(''), {headers:{'content-type':'text/event-stream'}});
          }
          if (target.pathname.endsWith(':batchEmbedContents')) {
            return Response.json({embeddings:[{values:[1,0,0,0,0,0,0,0]},{values:[0,1,0,0,0,0,0,0]}]});
          }
          const part = request.tools ? {functionCall:{name:'describe_shape',args:{color:'blue',sides:3}}} : {text:'Hello.'};
          const body = {candidates:[{index:0,content:{role:'model',parts:[part]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:11,candidatesTokenCount:3,totalTokenCount:14}};
          return target.searchParams.get('alt') === 'sse'
            ? new Response('data: '+JSON.stringify(body)+'\\n\\n', {headers:{'content-type':'text/event-stream'}})
            : Response.json(body);
        }
        if (target.hostname !== '127.0.0.1') throw new Error('Unexpected network');
        return realFetch(url, init);
      };
    `
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(intercept)}`,
        join(directory, 'record-gemini.mjs'),
        group,
      ],
      {
        env: {
          GEMINI_API_KEY: 'fake-cli-secret',
          ...(group === 'embed'
            ? { GEMINI_EMBEDDING_MODEL: 'synthetic-embedding' }
            : { GEMINI_MODEL: 'synthetic-model' }),
        },
        timeout: 10000,
      }
    )
    expect(result.stdout).toContain(`Saved gemini-${group}.live.json and verified SDK replay`)
    const saved = await readFile(join(directory, 'fixtures', `gemini-${group}.live.json`), 'utf8')
    expect(saved).not.toContain('fake-cli-secret')
    const cassette = JSON.parse(saved)
    const sdkPackage = JSON.parse(
      await readFile(
        new URL('../../package.json', pathToFileURL(createRequire(import.meta.url).resolve('@google/genai'))),
        'utf8'
      )
    )
    expect(sdkPackage.version).toEqual(expect.any(String))
    expect(sdkPackage.version.length).toBeGreaterThan(0)
    expect(cassette.provenance).toMatchObject({ source: 'gemini', providerSdkVersion: sdkPackage.version })
    expect(cassette.interactions).toHaveLength(1)
    expect(cassette.interactions[0].request.path).toContain(
      group === 'embed'
        ? ':batchEmbedContents'
        : group.startsWith('interaction')
          ? '/v1beta/interactions'
          : group.endsWith('stream')
            ? ':streamGenerateContent?alt=sse'
            : ':generateContent'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
