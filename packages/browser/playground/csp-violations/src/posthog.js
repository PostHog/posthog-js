// src/posthog.js
import posthog from 'posthog-js'

posthog.init(process.env.POSTHOG_TOKEN, {
    api_host: process.env.POSTHOG_API_HOST,
    ui_host: process.env.POSTHOG_UI_HOST,
    person_profiles: 'identified_only',
})

window.posthog = posthog
