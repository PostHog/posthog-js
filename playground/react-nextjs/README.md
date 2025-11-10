# PostHog React Playground

This is a Next.js playground application that demonstrates the `@posthog/react` SDK.

## Features

- **Cat Gallery**: A grid of cat images from [cataas.com](https://cataas.com)
- **Event Display**: Real-time display of PostHog events in the top-right corner

## Running the Playground

**Important**: This playground is excluded from the main workspace, so you need to install dependencies separately.

1. Navigate to this directory:

    ```bash
    cd playground/react-nextjs
    ```

2. Install dependencies:

    ```bash
    pnpm install
    ```

3. Run the development server:

    ```bash
    pnpm dev
    ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

5. Scroll down to see the cat gallery come into view and watch the `$element_viewed` event appear in the event display

## How It Works

- The `EventDisplay` component intercepts PostHog events and displays them in real-time
