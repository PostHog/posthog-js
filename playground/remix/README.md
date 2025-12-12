# PostHog Remix Playground

This is a basic Remix application demonstrating PostHog integration following the [official PostHog Remix documentation](https://posthog.com/docs/libraries/remix).

## Features

- Automatic pageview tracking with `capture_pageview: 'history_change'`
- Custom event capture using PostHog React hooks
- PostHog React Provider integration
- Proper Vite configuration for SSR support
- Navigation header for multi-page testing
- Media page with base64 images for replay testing

## Setup

### Quick Start

Run the automated setup script:

```bash
./bin/localdev.sh
```

This will:

1. Build the PostHog packages from the repo root
2. Create tarballs in the target directory
3. Set up symlinks
4. Install dependencies
5. Start the dev server

### Manual Setup

1. Build and package PostHog libraries from the repo root:

```bash
cd ../..
pnpm build
pnpm package
```

2. Return to the Remix playground and install dependencies:

```bash
cd playground/remix
pnpm install
```

3. Start the development server:

```bash
pnpm dev
```

4. Open http://localhost:5173 in your browser

## Example Pages

- **Home (`/`)** - Main page with custom event capture button
- **Media (`/media`)** - Base64 image generation and testing for session replay

## Additional Resources

- [PostHog Remix Documentation](https://posthog.com/docs/libraries/remix)
- [Remix Analytics Tutorial](https://posthog.com/tutorials/remix-analytics)
- [Remix A/B Testing](https://posthog.com/tutorials/remix-ab-tests)
- [Remix Surveys](https://posthog.com/tutorials/remix-surveys)
