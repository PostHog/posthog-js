import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { PostHog } from 'posthog-node'

const app = new Hono()

const posthog = new PostHog(process.env.POSTHOG_PROJECT_API_KEY!, {
    host: process.env.POSTHOG_API_HOST,
    enableExceptionAutocapture: true,
})

app.onError(async (err, c) => {
    posthog.captureException(new Error(err.message, { cause: err }), 'user_distinct_id_with_err_rethrow', {
        path: c.req.path,
        method: c.req.method,
        url: c.req.url,
        headers: c.req.header(),
        // ... other properties
    })
    // TIP: On program exit, call flush to stop pending pollers and flush any remaining events
    await posthog.flush()
    // other error handling logic
    return c.text('Internal Server Error', 500)
})

app.get('/', (c) => {
    return c.text('Hello Hono!')
})

app.get('/error', (c) => {
    throw new Error('This is an handled error')
})

app.get('/async_error', (c) => {
    setTimeout(() => {
        throw new Error('This is an autocaptured async error')
    }, 100)
    return c.text('Hello Hono!')
})

serve(
    {
        fetch: app.fetch,
        port: 3000,
    },
    (info) => {
        console.log(`Server is running on http://localhost:${info.port}`)
    }
)
