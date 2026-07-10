import { OpenFeature } from '@openfeature/web-sdk'
import { PostHogWebProvider } from '@posthog/openfeature-web-provider'
import posthog from 'posthog-js'

// Configure via a local .env file (VITE_POSTHOG_KEY / VITE_POSTHOG_HOST) or edit inline.
const PROJECT_API_KEY = import.meta.env.VITE_POSTHOG_KEY ?? '<ph_project_api_key>'
const API_HOST = import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com'

async function main(): Promise<void> {
  // 1. You own the posthog-js lifecycle. Manage user identity as usual
  //    (posthog.identify(...)); the provider never calls identify().
  posthog.init(PROJECT_API_KEY, { api_host: API_HOST })

  // 2. Register the PostHog provider with OpenFeature. setProviderAndWait
  //    resolves once the provider's initial flag load has settled.
  await OpenFeature.setProviderAndWait(new PostHogWebProvider(posthog))
  const client = OpenFeature.getClient()

  // 3. Evaluate flags through the vendor-neutral OpenFeature API. Web evaluation
  //    is synchronous. Swap these keys for real flags in your project.
  const result = {
    'my-boolean-flag': client.getBooleanValue('my-boolean-flag', false),
    'my-multivariate-flag': client.getStringValue('my-multivariate-flag', 'control'),
    'my-payload-flag': client.getObjectValue('my-payload-flag', {}),
  }

  render(result)

  // Optional: pass extra evaluation context (person/group properties). The
  // provider reconciles it into posthog-js and reloads flags before returning.
  // await OpenFeature.setContext({ plan: 'enterprise', groups: { organization: 'acme' } })
}

function render(result: Record<string, unknown>): void {
  const el = document.getElementById('app')
  if (el) {
    el.textContent = JSON.stringify(result, null, 2)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('OpenFeature example failed:', err)
})
