import { OpenFeature } from '@openfeature/server-sdk'
import { PostHogServerProvider } from '@posthog/openfeature-node-provider'
import { PostHog } from 'posthog-node'

// Configure via env vars or edit inline.
const PROJECT_API_KEY = process.env.POSTHOG_PROJECT_API_KEY ?? '<ph_project_api_key>'
const HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'

async function main(): Promise<void> {
  // 1. You own the posthog-node lifecycle. Pass a personalApiKey to enable
  //    local evaluation.
  const posthog = new PostHog(PROJECT_API_KEY, { host: HOST })

  // 2. Register the PostHog provider with OpenFeature.
  await OpenFeature.setProviderAndWait(new PostHogServerProvider(posthog))
  const client = OpenFeature.getClient()

  // 3. Evaluate flags through the vendor-neutral OpenFeature API. The distinct
  //    id comes from the evaluation context's targetingKey; other attributes
  //    map to person/group properties. Swap these keys for real flags.
  const context = { targetingKey: 'user_distinct_id', plan: 'enterprise' }
  // The reads are independent, so evaluate them concurrently.
  const [boolean, multivariate, payload] = await Promise.all([
    client.getBooleanValue('my-boolean-flag', false, context),
    client.getStringValue('my-multivariate-flag', 'control', context),
    client.getObjectValue('my-payload-flag', {}, context),
  ])
  const result = {
    'my-boolean-flag': boolean,
    'my-multivariate-flag': multivariate,
    'my-payload-flag': payload,
  }

  // eslint-disable-next-line no-console
  console.log(result)

  await posthog.shutdown()
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('OpenFeature example failed:', err)
  process.exit(1)
})
