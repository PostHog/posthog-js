# PostHog Node.js Flags Playground

This directory contains interactive demos for using PostHog feature flags and remote config with the Node.js SDK.

## Quick Start

### 1. Setup Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your PostHog credentials
# POSTHOG_PROJECT_KEY=phc_your_actual_project_key
# POSTHOG_PERSONAL_TOKEN=phx_your_actual_personal_token
# POSTHOG_HOST=http://localhost:8000
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Interactive Demo

```bash
npm start
```

This will show you a menu to choose between available demos:

```
🎯 PostHog Flags Playground
============================

Available demos:

1. Flag Dependencies Demo
   Test flag dependencies with local evaluation

2. Remote Config Demo
   Test PostHog remote config endpoint

Select a demo (1-2) or press Ctrl+C to exit:
```

## Available Demos

### 1. Flag Dependencies Demo (`flag-dependencies-demo.js`)

Tests the flag dependencies feature with local evaluation. This demo will:

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

### 2. Remote Config Demo (`remote-config-demo.js`)

Tests the PostHog remote config endpoint to retrieve encrypted configuration data. This demo will:

- Connect to your PostHog instance
- Fetch remote config payload for a specified flag
- Display the configuration data

#### Environment Variables

- `REMOTE_CONFIG_FLAG_KEY` - Flag key with remote config enabled (defaults to `unencrypted-remote-config-setting`)

## Manual Execution

You can also run individual demos directly:

```bash
# Build the package first
npm run build

# Run flag dependencies demo
npm run dependencies
# or directly: node flag-dependencies-demo.js

# Run remote config demo
npm run remote-config
# or directly: node remote-config-demo.js
```

## Troubleshooting

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
