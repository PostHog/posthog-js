import { createPostHog } from '@posthog/browser/core'
import { tracingHeaders } from '@posthog/browser/tracing-headers'

void createPostHog({
    projectToken: 'ph_test',
    extensions: [tracingHeaders({ hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] })],
})
