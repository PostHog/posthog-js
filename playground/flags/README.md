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

## PostHog Flag Dependencies Demo

This playground demonstrates the flag dependencies feature in posthog-node.

### Quick Start

1. **Set up environment variables:**

    ```bash
    cp .env.example .env
    ```

2. **Edit `.env` with your actual credentials:**

    ```bash
    POSTHOG_PROJECT_KEY=phc_your_actual_project_key
    POSTHOG_PERSONAL_TOKEN=phx_your_actual_personal_token
    POSTHOG_HOST=http://localhost:8010
    FLAG_KEY=test-dependent-flag
    ```

3. **Run the demo:**
    ```bash
    pnpm test
    # or manually:
    pnpm build && node flag-dependencies-demo.js
    ```

### What the Test Does

The script will:

- ✅ Connect to your local PostHog instance
- ✅ Load feature flags with local evaluation enabled
- ✅ Test the `test-dependent-flag` (or whatever flag you specify)
- ✅ Show dependency graph information
- ✅ Test different user scenarios
- ✅ Display all available flags

### Expected Output

```
🚀 Testing Flag Dependencies with Local PostHog Instance

🔧 Configuration:
   Host: http://localhost:8010
   Project Key: phc_abcd...
   Personal Token: phx_efgh...
   Test User ID: test-user-xyz

⏳ Waiting for flags to load...
✅ Flags loaded successfully!

🎯 Testing test-dependent-flag:
   Result: true
   ✅ Flag evaluated successfully: true

🔍 Testing all flags:
   Found 3 flags:
     base-feature: true
     test-dependent-flag: true
     another-flag: false

🧪 Testing with different user properties:
   Basic user: false
   Premium user: true
   Enterprise user: true

📊 Flag dependency information:
   Total flags in dependency graph: 3
   test-dependent-flag dependencies: [base-feature]
   ✅ No cyclic dependencies detected

🎉 Test completed!
```

### Troubleshooting

### Build Issues

If you get build errors:

- Run `pnpm build` from this directory to build the posthog-node package
- Or build from the repository root: `cd ../.. && pnpm build --filter=posthog-node`

#### Missing Environment Variables

- Copy `.env.example` to `.env`
- Get your project key from PostHog settings
- Get your personal API token from PostHog settings

#### No Flags Loaded

- Verify your PostHog instance is running on localhost:8010
- Check your API credentials are correct
- Ensure you have flags configured in your PostHog instance

#### Flag Not Found

- Create a flag named `test-dependent-flag` in your PostHog instance
- Or change `FLAG_KEY` in your `.env` to test a different flag
