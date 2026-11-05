/** @vitest-environment node */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

const HIDE_NODEMAILER = `
  import { registerHooks } from 'node:module'
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'nodemailer' || specifier.startsWith('nodemailer/')) {
        throw Object.assign(new Error('Cannot find module ' + specifier), { code: 'ERR_MODULE_NOT_FOUND' })
      }
      return nextResolve(specifier, context)
    },
  })
`

describe('the built posthog-node without Nodemailer installed', () => {
  it.each(['import', 'require'])('loads both entry points with %s and sends a message', (loader) => {
    const load = (specifier: string): string =>
      loader === 'import' ? `await import('${specifier}')` : `createRequire(import.meta.url)('${specifier}')`
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(HIDE_NODEMAILER)}`,
        '--input-type=module',
        '-e',
        `
          import { createRequire } from 'node:module'
          const { PostHog } = ${load('posthog-node')}
          const { createPostHogTransport } = ${load('posthog-node/nodemailer')}
          await import('nodemailer').then(() => { throw new Error('Nodemailer is still installed') }, () => {})
          const client = new PostHog('phc_test', {
            secretKey: 'phs_test',
            enableLocalEvaluation: false,
            fetch: async () => ({ status: 202, text: async () => '{"message_id":"msg_1"}', headers: { get: () => null } }),
          })
          const data = {
            from: { name: '', address: 'shop@example.com' },
            to: [{ name: '', address: 'ana@example.com' }],
            subject: 'Hi',
            text: 'Hi',
            envelope: { from: 'shop@example.com', to: ['ana@example.com'] },
          }
          const info = await new Promise((resolve, reject) =>
            createPostHogTransport({ client }).send({ normalize: (done) => done(null, data) }, (error, sent) =>
              error ? reject(error) : resolve(sent)
            )
          )
          await client.shutdown()
          console.log(JSON.stringify(info))
        `,
      ],
      { cwd: packageRoot, encoding: 'utf8', timeout: 10_000 }
    )

    expect(JSON.parse(output)).toEqual({ messageId: 'msg_1' })
  })
})
