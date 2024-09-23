# PostHog & Next.js App Router Demo

This project demonstrates how to integrate PostHog analytics with a Next.js application using the App Router. It includes examples of both client-side and server-side event tracking.

## Getting Started

First, install the dependencies:

```bash
npm install
```

Then, run the development server:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-posthog-api-key>' npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Examples

This demo project showcases:

1. Client-side event tracking using the `usePostHog` hook
2. Server-side event tracking using the PostHog Node.js library
3. Integration of PostHog with Next.js App Router

The main page (`/`) contains links to two sample pages:

-   `/client-event`: Demonstrates client-side event tracking
-   `/server-event`: Demonstrates server-side event tracking

## Environment Variables

The project uses the following environment variables:

-   `NEXT_PUBLIC_POSTHOG_KEY`: Your PostHog API key
-   `NEXT_PUBLIC_POSTHOG_HOST`: The PostHog host (optional, defaults to 'https://app.posthog.com')

You can set these in a `.env.local` file or provide them when running the development server.

## Running Against a Local PostHog Instance

If you're running PostHog locally, you can point the project to your local instance:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' npm run dev
```

## Testing Local Changes to posthog-js

If you need to test local changes to the `posthog-js` library, you can use npm link:

1. In your local `posthog-js` directory:

    ```bash
    npm link
    ```

2. In this project's directory:

    ```bash
    npm link posthog-js
    ```

3. Run the development server with your environment variables:
    ```bash
    NEXT_PUBLIC_POSTHOG_KEY='<your-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' npm run dev
    ```

## Learn More

To learn more about Next.js and PostHog, check out the following resources:

-   [Next.js Documentation](https://nextjs.org/docs)
-   [PostHog Documentation](https://posthog.com/docs)
-   [PostHog Next.js Framework Guide](https://posthog.com/docs/libraries/next-js)

## Deployment

You can deploy this Next.js app using [Vercel](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) or any other Next.js-compatible hosting platform.

Remember to set your environment variables in your deployment platform's settings.
