## PostHog demo project

First, run the development server:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Testing local changes to posthog-js

Running `pnpm dev` will run an additional script that uses pnpm to link `posthog-js` locally to this package.

If you need to provide environment variables, you can do so:

```bash
NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8010' pnpm dev
```

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
