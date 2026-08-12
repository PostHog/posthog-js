// Third-party analytics, error-monitoring, and session-replay vendor hosts.
//
// Two independent features share this list, so it lives here as a single source of truth — adding a
// vendor benefits both:
//   - session replay's network capture uses it as `payloadHostDenyList`: hosts whose request /
//     response bodies must never be recorded (privacy / no replay value).
//   - dead-click autocapture uses it to recognise a fetch as background telemetry rather than the
//     app's response to a click, so a beacon firing near a click can't wrongly suppress a dead click.
//
// Entries are matched as host *suffixes* (via `endsWith`), so each one also covers its subdomains
// (e.g. `.ingest.sentry.io` matches `o1234.ingest.sentry.io`).
export const THIRD_PARTY_TELEMETRY_HOST_DENY_LIST: string[] = [
    '.lr-ingest.io',
    '.ingest.sentry.io',
    '.clarity.ms',
    // NB no leading dot here
    // GA4/gtag beacons go to *.google-analytics.com; with Google Signals on they also hit
    // analytics.google.com (region1.analytics.google.com/g/collect), so deny both
    'google-analytics.com',
    'analytics.google.com',
    // New Relic browser agent (bam + bam-cell)
    'nr-data.net',
    // Datadog browser RUM intake
    'datadoghq.com',
    'datadoghq.eu',
    'ddog-gov.com',
    // other third-party analytics / session-replay vendors whose telemetry has no replay value
    'segment.io',
    'rudderstack.com',
    'amplitude.com',
    'mixpanel.com',
    // Hotjar uses both .com and .io for data collection
    'hotjar.com',
    'hotjar.io',
    'fullstory.com',
]
