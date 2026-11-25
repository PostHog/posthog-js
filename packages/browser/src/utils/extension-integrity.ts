// scripts/embed-extension-integrity.mjs replaces each placeholder in the built bundles with the SHA-384
// of that extension's final emitted bytes. Unreplaced placeholders are not valid hashes, so they fail closed.
export const EXTENSION_INTEGRITY: Record<string, string> = {
    'conversations.js': 'sha384-~conversations.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'crisp-chat-integration.js': 'sha384-~crisp-chat-integration.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'dead-clicks-autocapture.js': 'sha384-~dead-clicks-autocapture.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'exception-autocapture.js': 'sha384-~exception-autocapture.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'intercom-integration.js': 'sha384-~intercom-integration.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'lazy-recorder.js': 'sha384-~lazy-recorder.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'logs.js': 'sha384-~logs.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'product-tours.js': 'sha384-~product-tours.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'recorder.js': 'sha384-~recorder.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'surveys.js': 'sha384-~surveys.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'tracing-headers.js': 'sha384-~tracing-headers.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'web-vitals-soft-navs.js': 'sha384-~web-vitals-soft-navs.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'web-vitals-with-attribution-soft-navs.js':
        'sha384-~web-vitals-with-attribution-soft-navs.js~~~~~~~~~~~~~~~~~~~~~~~',
    'web-vitals-with-attribution.js': 'sha384-~web-vitals-with-attribution.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'web-vitals.js': 'sha384-~web-vitals.js~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
}
