# PostHog Flags Playground

This directory contains examples for using PostHog feature flags, evaluation tags/environments, and remote config.

## Examples

### 1. Evaluation Tags Example (Browser) ✅ WORKING

The `evaluation-tags-example.html` provides an interactive web interface to test evaluation tags/environments with feature flags.

**Features:**

- Interactive UI for adding/removing evaluation tags
- Real-time feature flag testing
- Visual feedback and logging
- Support for multiple evaluation environments via `evaluation_environments` config option

**Running the example:**

**Option A: Use CDN version (easiest)**

```bash
# The HTML file now uses PostHog from CDN by default
npm run serve
# Then open http://localhost:8080/evaluation-tags-example.html in your browser
```

**Option B: Use local build**

```bash
# First, build PostHog locally from the root directory
cd ../.. # Go to repository root
pnpm build

# Then serve the example
cd playground/flags
npm run serve

# Edit evaluation-tags-example.html to uncomment the local build script tag
# and comment out the CDN script
```

### 2. Evaluation Tags Example (Node.js) ⚠️ NOT YET SUPPORTED

**IMPORTANT:** Evaluation environments/tags are currently **ONLY supported in the browser SDK**, not in the Node.js SDK.

The `evaluation-tags-example.js` demonstrates what the API would look like once implemented in Node.js, but it will not actually send evaluation environments to the API yet.

**Why it doesn't work yet:**

- The browser SDK sends `evaluation_environments` in the `/flags/` API call
- The Node.js SDK doesn't have this implementation yet
- The feature needs to be added to `@posthog/core` and `posthog-node` packages

**Running the example (shows warning message):**

```bash
npm run evaluation-tags
```

### 3. Remote Config Example

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
