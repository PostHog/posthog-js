## PostHog demo project

### Testing local changes to packages

This is a simple project used to test local changes to the PostHog JS SDK packages.

#### Quick Start (Recommended)

Use the provided script that handles building, packaging, and running the dev server:

```bash
cd playground/nextjs
./bin/localdev.sh
```

With environment variables:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8010' ./bin/localdev.sh
```

This script will:

1. Build all packages in the monorepo
2. Package them into tarballs
3. Install dependencies in the playground
4. Start the dev server

Open [http://localhost:3000?\_\_posthog_debug=true](http://localhost:3000?__posthog_debug=true) to see debug logs.

#### Manual Setup

If you prefer to run steps manually:

1. From the root of the repo, build and package:

```bash
pnpm install
pnpm build
pnpm package
```

2. From this folder, install dependencies and run dev:

```bash
pnpm install
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8010' pnpm dev
```

#### How it works

The playground is excluded from the workspace (see `pnpm-workspace.yaml`). Dependencies are rewritten by `playground/.pnpmfile.cjs` to use tarballs from the `target/` directory instead of workspace links. This means you must run `pnpm package` after making changes to see them in the playground.

### Testing cross-subdomain tracking

We can locally debug the cross-domain behaviour of posthog-js by editing our /etc/hosts file to point some fake
subdomains to localhost. There are a few steps required to do this, these are the instructions for doing this on MacOS
with Chrome:

Add the following to your /etc/host file:

```
127.0.0.1 www.posthog.dev
127.0.0.1 app.posthog.dev
```

To restart your DNS server on MacOS, run:

```bash
sudo killall -HUP mDNSResponder
```

Run this modified command to start the server. It will ask you to for sudo permissions to create a self-signed cert for https.

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' pnpm dev-crossdomain
```

You can now open the subdomains we added to the host file, but you will likely see a warning about unsafe certificates. To get around this, in Chrome you can type `thisisunsafe` to bypass the warning.
The subdomains are:

- [https://www.posthog.dev:3000](https://www.posthog.dev:3000)
- [https://app.posthog.dev:3000](https://app.posthog.dev:3000)
