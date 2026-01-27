import { Hono } from 'hono'
import { PostHog } from 'posthog-node'

const app = new Hono()

app.get('/', async (c) => {
  const posthog = new PostHog(
    process.env.POSTHOG_PROJECT_API_KEY!,
    { host: process.env.POSTHOG_API_HOST! }
  )

  const error = new Error('test from cloudflare')
  posthog.captureException(error, 'cloudflare-user-id')

  await posthog.flush()
  await posthog.shutdown()

  return c.json({ success: true, message: 'Exception captured!' })
})

export default app
