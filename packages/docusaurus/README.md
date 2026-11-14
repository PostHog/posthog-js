# PostHog plugin for Docusaurus

Easily track and improve your Docusaurus site with PostHog. See [our docs on this plugin](https://posthog.com/docs/libraries/docusaurus) for more information.

## Installing the plugin

```bash
npm install posthog-docusaurus --save
```

or

```bash
yarn add posthog-docusaurus
```

## Configuring the plugin

```javascript
// docusaurus.config.js
module.exports = {
    plugins: [
        [
            'posthog-docusaurus',
            {
                apiKey: '<ph_project_api_key>',
                appUrl: '<ph_client_api_host>', // optional, defaults to "https://us.i.posthog.com"
                enableInDevelopment: false, // optional
            },
        ],
    ],
}
```

> **Note:**You can pass additional PostHog [config options](https://posthog.com/docs/libraries/js#config) to the plugin, but they are passed through `JSON.stringify()`, so functions (such as `sanitize_properties`) are not supported.

## Using the plugin

Once running, this autocaptures pageviews, events, and session replay (if enabled) and enables usage of other PostHog features like surveys.

## Docusaurus compatibility

Verified with Docusaurus **3.10.2** and React **19.3.1** using the [sample and browser tests](https://github.com/PostHog/posthog-js/tree/main/examples/example-docusaurus).

The SDK captures the initial pageview, and Docusaurus's route hook captures subsequent pathname changes. The hook skips the initial load to avoid a duplicate pageview. SDK defaults and explicit options remain unchanged, preserving default pageleave capture and the landing pageview after consent is granted.
