## PostHog demo project

First, run the development server:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.


### Against a locally running PostHog instance

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' pnpm dev
```

### Testing local changes to posthog-js

Running `pnpm dev` will run an additional script that uses pnpm to link `posthog-js` locally to this package.

If you need to provide environment variables, you can do so:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' pnpm dev
```

