import { PostHog } from 'posthog-node'

export default async function handler(_req, res) {
  let captured
  const client = new PostHog('phc_integration', {
    flushInterval: 0,
    before_send(event) {
      captured = event
      return null
    },
    fetch: async () => {
      throw new Error('The fixture must never send analytics requests')
    },
  })
  client.captureException(new Error('Externalized server SDK fixture'), 'fixture-user')
  await client.shutdown()
  res.json({
    event: captured?.event,
    releaseId: captured?.properties?.$release_id ?? null,
    compiledReleaseId: process.env.POSTHOG_RELEASE_ID ?? null,
    runtimeEnvironment: Reflect.get(process.env, 'POSTHOG_RELEASE_ID') ?? null,
    globalReleaseId: globalThis._posthogReleaseId ?? null,
  })
}
