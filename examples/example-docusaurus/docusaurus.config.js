module.exports = {
    title: 'PostHog compatibility sample',
    url: 'https://example.com',
    baseUrl: '/',
    presets: [['classic', { docs: false, blog: false }]],
    plugins: [
        [
            'posthog-docusaurus',
            {
                apiKey: 'phc_docusaurus_local_test',
                appUrl: process.env.POSTHOG_TEST_API_HOST || 'https://us.i.posthog.com',
                enableInDevelopment: process.env.POSTHOG_ENABLE_IN_DEVELOPMENT === 'true',
                ...(process.env.POSTHOG_TEST_API_HOST
                    ? {
                          opt_out_useragent_filter: true,
                          disable_compression: true,
                          request_batching: false,
                          opt_out_capturing_by_default: process.env.POSTHOG_TEST_OPT_OUT === 'true',
                          disable_session_recording: true,
                          disable_surveys: true,
                      }
                    : {}),
            },
        ],
    ],
}
