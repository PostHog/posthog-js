# PostHog Node.js Memory Diagnostics

This directory contains diagnostic tools for debugging memory leaks and performance issues in the PostHog Node.js SDK.

## Scripts

### `memory-leak-diagnostic.js`

**Primary diagnostic tool** for identifying memory leaks in PostHog API methods.

- Tests each API method in isolation (getFeatureFlag, getAllFlags, etc.)
- Measures memory growth over thousands of iterations
- Generates a ranked report showing which methods leak the most memory
- Forces garbage collection between tests for accurate measurements

**Usage:**

```bash
# From examples/example-node/, copy .env.example to .env and configure your API keys
cd ..
cp .env.example .env
cd diagnostics

# Run the diagnostic
node --expose-gc memory-leak-diagnostic.js
```

**Output:**

- Console report ranking methods by memory growth
- Detailed JSON report saved to `memory-leak-diagnostic-report.json`

### `heap-snapshot-helper.js`

**Advanced debugging tool** for deep memory analysis using V8 heap snapshots.

- Takes heap snapshots before/after operations
- Focuses on suspected leak sources (payload operations, cache behavior)
- Generates `.heapsnapshot` files for analysis in Chrome DevTools

**Usage:**

```bash
# Run heap snapshot analysis
node --expose-gc heap-snapshot-helper.js

# Or for quick reproduction of leak patterns
node --expose-gc heap-snapshot-helper.js quick
```

**Analysis:**

1. Open Chrome DevTools → Memory tab
2. Load the generated `.heapsnapshot` files
3. Compare snapshots to identify accumulating objects
4. Focus on PostHog-related objects, arrays, and closures

## Configuration

From the parent directory (`examples/example-node/`), copy `.env.example` to `.env` and configure:

```bash
cd ../  # From diagnostics/ go to examples/example-node/
cp .env.example .env
# Edit .env with your actual values
```

The `.env` file should contain:

```env
POSTHOG_PROJECT_API_KEY=phc_your_project_api_key_here
POSTHOG_PERSONAL_API_KEY=phx_your_personal_api_key_here
POSTHOG_HOST=https://app.posthog.com
POSTHOG_TEST_FLAG_KEY=beta-feature
```

**Note:** No flags need to exist on the server - the diagnostics work with non-existent flags and still detect memory leaks.
