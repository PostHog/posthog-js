# PostHog Cloudflare KV Cache Example

This example demonstrates how to implement a distributed cache for PostHog feature flag definitions using Cloudflare KV storage. It showcases a split read/write pattern optimized for edge workers where low-latency flag evaluation is critical.

## Architecture

The example uses two specialized cache implementations:

- **`CloudflareKVFlagCacheReader`** - Read-only cache used in request handlers to evaluate flags locally without API calls
- **`CloudflareKVFlagCacheWriter`** - Write-only cache used in scheduled jobs to periodically refresh flag definitions

### How It Works

1. A Cloudflare Worker scheduled job (cron) runs every 5 minutes
2. The scheduled job fetches fresh flag definitions from PostHog and stores them in Cloudflare KV
3. Request handlers read flag definitions from KV and evaluate flags locally
4. No API calls are made during request handling, ensuring minimal latency

This pattern is ideal for high-traffic edge applications where:

- Flag evaluation must be extremely fast
- You want to minimize API calls to PostHog
- You can tolerate flag updates being slightly delayed (up to 5 minutes, or your own cron schedule)

## Prerequisites

- Node.js and pnpm installed
- A PostHog account with a project API key and personal API key

## Setup

### 1. Build Local Dependencies

From the root of the posthog-js repository:

```bash
pnpm i
pnpm package
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your PostHog credentials:

```bash
cp .env.example .env
```

Edit `.env` and set:

```
POSTHOG_PROJECT_KEY=your_project_api_key
POSTHOG_PERSONAL_API_KEY=your_posthog_personal_api_key
POSTHOG_HOST=https://us.i.posthog.com
```

### 3. Build the Example

```bash
pnpm build
```

## Running Locally

### Start the Cloudflare Worker

```bash
pnpm dev
```

### Trigger the Scheduled Job

Manually trigger the cache update to populate flag definitions:

```bash
curl http://127.0.0.1:8788/cdn-cgi/handler/scheduled
```

Expected response:

```
ok
```

### Test Flag Evaluation

Request the worker endpoint to evaluate a flag locally:

```bash
curl http://127.0.0.1:8787
```

Expected response:

```json
{ "userId": "wvhqg4goolm", "feature": "beta-feature", "enabled": true }
```

The `userId` will be randomly generated for each request, and `enabled` will depend on your flag configuration in PostHog.
