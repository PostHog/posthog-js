import 'dotenv/config'
import express, { Request, Response } from 'express'
import path from 'path'

const app = express()
const PORT = 8080

const removeTrailingSlash = (str: string): string => str.replace(/\/$/, '')

// Environment variables (with fallbacks for local development)
const POSTHOG_TOKEN = process.env.POSTHOG_TOKEN || 'test-key'
const POSTHOG_API_HOST = removeTrailingSlash(process.env.POSTHOG_API_HOST || 'https://us.i.posthog.com')
const POSTHOG_UI_HOST = removeTrailingSlash(process.env.POSTHOG_UI_HOST || POSTHOG_API_HOST)

// Serve static assets
app.use('/static', express.static(path.join(__dirname, '../static')))

// Serve the built PostHog library from the parent directory
app.use('/posthog', express.static(path.join(__dirname, '../../../dist')))

// Home page with React app
app.get('/', (req: Request, res: Response) => {
    const userAgent = req.headers['user-agent'] || 'No User Agent'

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot Detection Playground</title>
      <link href="/static/styles.css" rel="stylesheet">
      <script src="/posthog/array.js"></script>
      <script src="/static/bot-data.js"></script>
    </head>
    <body>
      <div
        id="root"
        data-token="${POSTHOG_TOKEN}"
        data-api-host="${POSTHOG_API_HOST}"
        data-ui-host="${POSTHOG_UI_HOST}"
        data-user-agent="${userAgent.replace(/"/g, '&quot;')}"
      ></div>
      <script src="/static/bundle.js"></script>
    </body>
    </html>
  `)
})

app.listen(PORT, () => {
    console.log(`🚀 Bot Detection Playground running at http://localhost:${PORT}`)
    console.log(`📊 PostHog: ${POSTHOG_API_HOST}`)
    console.log(`🔑 Token: ${POSTHOG_TOKEN}`)
})
