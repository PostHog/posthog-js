/* eslint-disable no-console */

import express from 'express'
import { PostHog, setupExpressErrorHandler } from 'posthog-node'
// import undici from 'undici'

const app = express()

const { POSTHOG_PROJECT_API_KEY, POSTHOG_API_HOST, POSTHOG_PERSONAL_API_KEY } = process.env

const posthog = new PostHog(POSTHOG_PROJECT_API_KEY!, {
    host: POSTHOG_API_HOST,
    flushAt: 1,
    personalApiKey: POSTHOG_PERSONAL_API_KEY,
    // By default PostHog uses node fetch but you can specify your own implementation if preferred
    // fetch(url, options) {
    //   console.log(url, options)
    //   return undici.fetch(url, options)
    // },
})

console.log('LOCAL EVALUATION READY RIGHT AFTER CREATION: ', posthog.isLocalEvaluationReady())

posthog.on('localEvaluationFlagsLoaded', (count) => {
    console.log('LOCAL EVALUATION READY (localEvaluationFlagsLoaded) EVENT EMITTED: flags count: ', count)
})

posthog.debug()

app.get('/', (req, res) => {
    posthog.capture({ distinctId: 'EXAMPLE_APP_GLOBAL', event: 'legacy capture' })
    res.send({ hello: 'world' })
})

app.get('/unhandled-error', () => {
    throw new Error('unhandled error')
})

app.get('/error', (req, res) => {
    const error = new Error('example error')
    posthog.captureException(error, 'EXAMPLE_APP_GLOBAL')
    res.send({ status: 'error!!' })
})

app.get('/wait-for-local-evaluation-ready', async (req, res) => {
    const FIVE_SECONDS = 5000
    const ready = await posthog.waitForLocalEvaluationReady(FIVE_SECONDS)
    res.send({ ready })
})

app.get('/user/:userId/action', (req, res) => {
    posthog.capture({ distinctId: req.params.userId, event: 'user did action', properties: req.params })

    res.send({ status: 'ok' })
})

app.get('/user/:userId/flags/:flagId', async (req, res) => {
    const flag = await posthog.getFeatureFlag(req.params.flagId, req.params.userId).catch((e) => console.error(e))
    const payload = await posthog
        .getFeatureFlagPayload(req.params.flagId, req.params.userId)
        .catch((e) => console.error(e))
    res.send({ [req.params.flagId]: { flag, payload } })
})

app.get('/user/:userId/flags', async (req, res) => {
    const allFlags = await posthog.getAllFlagsAndPayloads(req.params.userId).catch((e) => console.error(e))
    res.send(allFlags)
})

// Error handling middleware must be placed at the END of your application stack
setupExpressErrorHandler(posthog, app)

const server = app.listen(8020, () => {
    console.log('⚡: Server is running at http://localhost:8020')
})

async function handleExit(signal: any) {
    console.log(`Received ${signal}. Flushing...`)
    await posthog.shutdown()
    console.log(`Flush complete`)
    server.close(() => {
        process.exit(0)
    })
}
process.on('SIGINT', handleExit)
process.on('SIGQUIT', handleExit)
process.on('SIGTERM', handleExit)
