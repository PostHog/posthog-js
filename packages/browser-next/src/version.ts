declare const __POSTHOG_BROWSER_VERSION__: string

export const version = typeof __POSTHOG_BROWSER_VERSION__ === 'string' ? __POSTHOG_BROWSER_VERSION__ : '0.0.0'
