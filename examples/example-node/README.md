# PostHog Node.js SDK Example

This interactive example demonstrates various PostHog Node.js SDK capabilities including:

- Basic event capture and user identification
- Feature flag local evaluation
- Feature flag payloads
- **Flag dependencies evaluation** (NEW!)
- Interactive menu system for choosing specific examples

## Setup

### 1. Configure PostHog Credentials

Copy the example environment file and fill in your PostHog credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```bash
# Your project API key (found on the /setup page in PostHog)
POSTHOG_PROJECT_API_KEY=phc_your_project_api_key_here

# Your personal API key (for local evaluation and other advanced features)
POSTHOG_PERSONAL_API_KEY=phx_your_personal_api_key_here

# PostHog host URL (remove this line if using posthog.com)
POSTHOG_HOST=https://app.posthog.com
```

### 2. Getting Your API Keys

**Project API Key:**

1. Go to your PostHog instance → Settings → Project Settings
2. Copy the "Project API Key"

**Personal API Key:**

1. Go to your PostHog instance → Settings → Personal API Keys
2. Create a new Personal API Key (required for local evaluation)

### 3. Install Dependencies

From the workspace root (`/path/to/posthog-js/`):

```bash
# Build and package the SDK
pnpm package

# Install example dependencies
cd examples/example-node
pnpm install
```

### 4. Run the Example

```bash
# Run the interactive example
pnpm run example

# Or use tsx directly
npx tsx example.ts
```

## Interactive Menu

When you run the example, you'll see an interactive menu:

```
🚀 PostHog Node.js SDK Demo - Choose an example to run:

1. Identify and capture examples
2. Feature flag local evaluation examples
3. Feature flag payload examples
4. Flag dependencies examples
5. Run all examples
6. Exit

Enter your choice (1-6):
```

### Available Examples

**1. Identify and Capture Examples**

- Basic event capture with properties
- User identification and properties
- Group identification
- Aliasing users
- Event capture with feature flags

**2. Feature Flag Local Evaluation Examples**

- Basic feature flag evaluation
- Location-based flags with person properties
- Group-based flags
- Getting all flags (with/without local evaluation)
- Performance comparison

**3. Feature Flag Payload Examples**

- Feature flag payloads
- All flags and payloads
- Remote config payloads
- Error handling for missing payloads

**4. Flag Dependencies Examples** ⭐ _NEW!_

- Simple flag dependencies
- Multi-level dependency chains
- Different operators (`exact`, `is_not`, arrays)
- Performance and caching demonstrations
- Local evaluation without API calls

**5. Run All Examples**

- Runs a condensed version of all examples
- Great for testing that everything works
- Shows the breadth of SDK capabilities

## Flag Dependencies Demo

The example includes a comprehensive flag dependencies demonstration showing:

- **Basic Dependencies**: Flags that depend on other flags
- **Multi-level Dependencies**: Complex dependency chains (A → B → C)
- **Local Evaluation**: All dependencies evaluated locally (zero API calls)
- **Different Operators**: `exact`, `is_not`, array values
- **Performance**: Caching and timing demonstrations

### Optional: Setup Test Flags

For the best experience, create these flags in your PostHog instance:

1. **`beta-feature`** flag:

    - Condition: `email` contains `@example.com`
    - Rollout: 100%

2. **`test-flag-dependency`** flag:
    - Condition: flag `beta-feature` is enabled
    - Rollout: 100%

The example will work without these flags (they'll evaluate to `false`), but creating them will show the full functionality.

## Expected Output

When you run the example, you'll see:

1. **Authentication Test**: Validates your PostHog credentials
2. **Interactive Menu**: Choose which examples to run
3. **Selected Examples**: Run with detailed output and explanations

Example output for flag dependencies (option 4):

```
============================================================
FLAG DEPENDENCIES EXAMPLES
============================================================
🔗 Testing flag dependencies with local evaluation...
✅ @example.com user (test-flag-dependency): true
❌ Regular user (test-flag-dependency): false
🎯 Results Summary:
   - Flag dependencies evaluated locally: ✅ YES
   - Zero API calls needed: ✅ YES
   - Node.js SDK supports flag dependencies: ✅ YES
```

## Quick Start

For a quick demonstration of all features:

```bash
pnpm run example
# Choose option 5: "Run all examples"
```

This will run a condensed version of all SDK capabilities in sequence.

## Troubleshooting

- **"Missing PostHog credentials"**: Make sure your `.env` file exists and has valid API keys
- **"Authentication test failed"**: Check that your Personal API key is correct and has the right permissions
- **Flags evaluate to `false`**: This is normal if you haven't created the test flags in your PostHog instance
