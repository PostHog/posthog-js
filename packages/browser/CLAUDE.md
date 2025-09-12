# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

- `pnpm build` - Build the library (TypeScript compilation + Rollup bundling)
- `pnpm dev` - Start development with file watching
- `pnpm start` - Build React components and start Rollup in watch mode
- `pnpm clean` - Remove build artifacts (lib/, dist/, react/dist/)

### Testing

- `pnpm test` - Run all tests (unit + functional)
- `pnpm test:unit` - Run unit tests only
- `pnpm test:unit:surveys` - Run survey-specific unit tests
- `pnpm test:functional` - Run functional tests
- `pnpm test-watch` - Run unit tests in watch mode
- `pnpm test:typecheck` - Run TypeScript type checking on tests

### Code Quality

- `pnpm lint` - Lint source and playwright code
- `pnpm lint:fix` - Auto-fix linting issues
- `pnpm prettier` - Format code
- `pnpm prettier:check` - Check code formatting
- `pnpm typecheck` - TypeScript type checking

### E2E Testing

- `pnpm playwright` - Run Playwright tests across browsers
- `pnpm playwright-ui` - Run Playwright with UI
- `pnpm playwright:surveys` - Run survey-specific Playwright tests
- `pnpm playwright:surveys:ui` - Run survey Playwright tests with UI

### Single Test Execution

- `jest src/path/to/test.test.ts` - Run specific unit test
- `pnpm exec playwright test path/to/test.spec.ts` - Run specific Playwright test

## Architecture Overview

### Core Structure

- **posthog-core.ts** - Main PostHog class with all public APIs
- **config.ts** - Configuration management and defaults
- **posthog-persistence.ts** - Browser storage management (localStorage, cookies)
- **posthog-featureflags.ts** - Feature flag functionality
- **posthog-surveys.ts** - Survey management and display
- **request-queue.ts** - Event batching and network request handling
- **sessionid.ts** - Session management

### Extensions Architecture

The `/src/extensions/` directory contains modular features:

- **surveys.tsx** - Survey UI components (Preact-based)
- **replay/sessionrecording.ts** - Session recording functionality
- **autocapture/** - Automatic event capture
- **toolbar.ts** - PostHog toolbar integration
- **sentry-integration.ts** - Sentry error tracking integration
- **segment-integration.ts** - Segment analytics integration

### Key Concepts

- **Extensions Pattern** - Features are modular extensions that can be enabled/disabled
- **Event Queue** - All events go through a request queue for batching and retry logic
- **Persistence Layer** - Unified storage abstraction over localStorage/cookies
- **Remote Config** - Dynamic configuration loaded from PostHog servers
- **Consent Management** - GDPR-compliant consent handling

### Build System

- **TypeScript** compilation to `lib/` directory
- **Rollup** bundling with multiple output formats (ES modules, UMD)
- **Preact** for UI components (surveys, toolbar)
- **PostCSS** for CSS processing with nesting support
- **Terser** for minification with property mangling

### Testing Strategy

1. **Unit Tests** (Jest) - Core functionality, utils, individual classes
2. **Functional Tests** - Integration testing with mocked APIs
3. **Playwright Tests** - Real browser automation testing
4. **TestCafe E2E** - Full integration with real PostHog instance

### Package Management

- Uses **pnpm** (not npm) for dependency management
- Workspace setup with `@posthog/core` internal dependency
- Optional peer dependencies for Angular compiler support

### Important Notes

- Must run `pnpm build` before running tests
- React/Preact components in extensions use JSX factory `h`
- Property mangling used in production builds for size optimization
- IE11 support maintained through Babel compilation
