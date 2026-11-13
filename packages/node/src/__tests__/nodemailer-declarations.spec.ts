/** @vitest-environment node */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

const CONSUMER = `
  import nodemailer from 'nodemailer'
  import { PostHog } from 'posthog-node'
  import { createPostHogTransport } from 'posthog-node/nodemailer'

  const client = new PostHog('phc_test', { secretKey: 'phs_test' })
  const transporter = nodemailer.createTransport(createPostHogTransport({ client }))

  export const messageId: Promise<string> = transporter
    .sendMail({
      to: 'ana@example.com',
      subject: 'Hi',
      text: 'Hi',
      posthog: { distinct_id: 'user_42', tracking: { opens: true, clicks: false }, sensitive: true },
    })
    .then((info) => info.messageId)

  // @ts-expect-error a PostHog send has no SMTP fields
  export const accepted = transporter.sendMail({ to: 'ana@example.com', text: 'Hi' }).then((info) => info.accepted)

  // @ts-expect-error the PostHog options keep the API's names
  export const misnamed = transporter.sendMail({ to: 'ana@example.com', text: 'Hi', posthog: { distinctId: 'user_42' } })
`

describe('the built posthog-node/nodemailer declarations', () => {
  let consumer: string

  beforeAll(() => {
    consumer = mkdtempSync(join(tmpdir(), 'posthog-nodemailer-consumer-'))
    mkdirSync(join(consumer, 'node_modules/@types'), { recursive: true })
    symlinkSync(packageRoot, join(consumer, 'node_modules/posthog-node'))
    symlinkSync(join(packageRoot, 'node_modules/nodemailer'), join(consumer, 'node_modules/nodemailer'))
    symlinkSync(join(packageRoot, 'node_modules/@types/node'), join(consumer, 'node_modules/@types/node'))
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  })

  afterAll(() => rmSync(consumer, { recursive: true, force: true }))

  it.each(['mts', 'cts'])('type-check sendMail with PostHog options in a NodeNext .%s consumer', (extension) => {
    writeFileSync(join(consumer, `consumer.${extension}`), CONSUMER)
    writeFileSync(
      join(consumer, `tsconfig.${extension}.json`),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
          esModuleInterop: true,
        },
        files: [`consumer.${extension}`],
      })
    )

    const result = spawnSync(
      process.execPath,
      [join(packageRoot, 'node_modules/typescript/bin/tsc'), '-p', `tsconfig.${extension}.json`, '--pretty', 'false'],
      { cwd: consumer, encoding: 'utf8', timeout: 60_000 }
    )

    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
