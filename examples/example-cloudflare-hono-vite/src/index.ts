import { Hono } from 'hono'
import { PostHog } from 'posthog-node'

const app = new Hono()

const posthog = new PostHog(
  process.env.POSTHOG_PROJECT_API_KEY!,
  { host: process.env.POSTHOG_API_HOST! }
)

app.get('/', async (c) => {

  const error = new Error('test from cloudflare')
  posthog.captureExceptionImmediate(error, 'cloudflare-user-id')

  return c.json({ success: true, message: 'Exception captured!' })
})

export default app
