# Backwards Compatibility Testing

This repository includes automated backwards compatibility testing to ensure that changes don't break users who have older versions of `array.js` cached in their browsers.

## How it Works

When users visit a website using PostHog, their browser caches the `array.js` file. If we release a new version that's incompatible with the cached version, users may experience issues until their cache expires.

Our backwards compatibility testing:

1. **Builds historical versions** - Checks out the last few releases and builds their `array.js` files
2. **Runs current tests** - Uses the current test suite but with the historical `array.js` versions
3. **Reports compatibility** - Shows which versions would break with the current changes

## When Tests Run

The backwards compatibility tests automatically run when:

- A PR is labeled with `release`
- New commits are pushed to a PR that already has the `release` label

## Running Locally

```bash
# Run interactively (shows HTML reports)
cd packages/browser
pnpm test:backwards-compatibility

# Run in CI mode (no interactive elements)
pnpm test:backwards-compatibility:ci

# Test more versions
pnpm test:backwards-compatibility -- --count=10

# Get help
pnpm test:backwards-compatibility -- --help
```

## Understanding Results

### ✅ All Tests Pass
The current changes are backwards compatible. Users with cached older versions should continue working normally.

### ❌ Tests Fail
The changes introduce backwards compatibility issues. This could mean:

- **Breaking API changes** - Methods or properties were removed/changed
- **Critical bug fixes** - The old version had bugs that are now exposed by better tests
- **Infrastructure changes** - Build or loading changes that affect older versions

## What to Do When Tests Fail

1. **Review the failure details** - Check which specific tests are failing
2. **Assess the impact** - Is this an acceptable breaking change for a release?
3. **Consider alternatives** - Can you maintain backwards compatibility?
4. **Document breaking changes** - If intentional, ensure it's in the release notes
5. **Communicate clearly** - Let users know what might break and how to fix it

## Configuration

The test script is located at `packages/browser/scripts/backwards-compatibility-test.mjs`.

Key configuration options:
- `--count=N` - Test against the last N releases (default: 5)
- `--ci` - Run in CI mode (non-interactive)

The GitHub Action tests the last 3 releases by default for faster execution.