# PostHog Node.js Flags Playground

This directory contains examples for using PostHog feature flags and remote config with the Node.js SDK.

## Remote Config Example

The `remote-config-example.js` demonstrates how to use the remote config endpoint to retrieve encrypted configuration data.

### Setup

1. Update the API keys in `remote-config-example.js`:

    - `phc_YOUR_PROJECT_API_KEY_HERE` - Your PostHog project API key
    - `phx_YOUR_SECURE_FLAGS_API_KEY_HERE` - Your PostHog secure flags API key (or personal API key)

2. Update the host if needed:

    - For PostHog Cloud US: `https://us.posthog.com`
    - For PostHog Cloud EU: `https://eu.posthog.com`
    - For self-hosted: `http://your-posthog-instance.com`

3. Update the feature flag key to match an actual flag in your project that has remote config enabled.

### Running the Example

```bash
# Install dependencies
npm install

# Run the remote config example
npm run remote-config
# or
node remote-config-example.js
```

### Expected Output

```bash
Testing remote config endpoint...
✅ Success! Remote config payload for 'your-flag-key': { "setting": "value", "config": {...} }
```
