import { defineApp } from 'convex/server'
import posthog from '@posthog/convex/convex.config.js'
import agent from '@convex-dev/agent/convex.config'

const app = defineApp()
app.use(posthog)
app.use(agent)

export default app
