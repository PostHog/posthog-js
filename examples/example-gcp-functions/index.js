const functions = require('@google-cloud/functions-framework')
const { PostHog } = require('posthog-node')

const posthog = new PostHog(process.env.POSTHOG_API_KEY, {
  // works as well if you uncomment the following lines
  // flushAt: 1,
  // flushInterval: 0
})
posthog.debug(true)

async function sendEvent(id) {
  // works as well if you uncomment the following line, and comment the global posthog declaration
  // const posthog = new PostHog('phc_pQ70jJhZKHRvDIL5ruOErnPy6xiAiWCqlL4ayELj4X8')
  // posthog.debug(true)

  posthog.capture({
    distinctId: 'test',
    event: 'test' + id,
  })

  await posthog.flush()
}

functions.http('helloWorld', async (req, res) => {
  console.info('PostHog before hello')

  res.send('Hello, World')

  console.info('PostHog before send event')

  await sendEvent(req.executionId)

  console.info('PostHog end')
})
