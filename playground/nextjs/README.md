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
Follow the instructions to set up YALC in the [root README](../../README.md).

After you have run `yalc publish` in the root directory, run `yalc add posthog-js` in this directory, and then you can
run `pnpm dev` to see your changes reflected in the demo project.

There is a shorthand script for running these 3 commands

```bash
pnpm yalc-dev
```

If you need to provide environment variables, you can do so, like

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' pnpm yalc-dev
```

