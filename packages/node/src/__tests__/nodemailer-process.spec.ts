/** @vitest-environment node */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

const SCRIPT_WITH_A_STALLED_ATTACHMENT = `
  import { PassThrough } from 'node:stream'
  import nodemailer from 'nodemailer'
  import { PostHog } from 'posthog-node'
  import { createPostHogTransport } from 'posthog-node/nodemailer'

  const client = new PostHog('phc_test', { secretKey: 'phs_test', enableLocalEvaluation: false })
  const transporter = nodemailer.createTransport(createPostHogTransport({ client }))
  await transporter.sendMail({
    from: 'shop@example.com',
    to: 'ana@example.com',
    subject: 'Report',
    text: 'Attached.',
    attachments: [{ filename: 'report.csv', content: new PassThrough() }],
  })
`

describe('the built posthog-node/nodemailer in a script', () => {
  it('keeps the script running while it waits for an attachment, so the send can still fail', async () => {
    vi.useRealTimers()
    const script = spawn(process.execPath, ['--input-type=module', '-e', SCRIPT_WITH_A_STALLED_ATTACHMENT], {
      cwd: packageRoot,
      stdio: 'ignore',
    })
    const exited = new Promise<number | null>((resolve) => script.once('exit', resolve))

    const outcome = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('running'), 2_000))])
    script.kill()
    await exited

    expect(outcome).toBe('running')
  })
})
