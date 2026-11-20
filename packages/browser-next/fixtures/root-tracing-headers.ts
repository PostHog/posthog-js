import { createPostHog } from '@posthog/browser'

void createPostHog({
    projectToken: 'ph_test',
    tracingHeaders: { hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] },
})
