# CSP Violations Playground

A development playground for testing CSP violation reports with PostHog.

## Setup

Before running the playground, make sure to update the required env variables for `server.js` to work:

Create a `.env` file in the root directory with the following variables:

```bash
POSTHOG_TOKEN=your_posthog_token
POSTHOG_API_HOST=your_posthog_api_host  # e.g., https://app.posthog.com
POSTHOG_UI_HOST=your_posthog_ui_host    # e.g., https://app.posthog.com
POSTHOG_USE_SNIPPET=true                # if you want to include the posthog snippet on the playground pages to track pageviews, etc.
```

These environment variables are required for the playground to work correctly. The server will fail to start if they are not properly configured.

## Installation

Install the dependencies:

```bash
pnpm i
```

## Running the Playground

```bash
pnpm dev
```

This uses nodemon to automatically restart the server when you make changes to the files.

## Usage

Once the server is running, open your browser and navigate to:

```
http://localhost:8080
```

The playground includes examples for different types of CSP violations:

1. **Inline Script Violation** - Tests violations of inline scripts
2. **External Script Violation** - Tests loading scripts from non-allowed domains
3. **External Image Violation** - Tests loading images from non-allowed domains
4. **External Style Violation** - Tests loading stylesheets from non-allowed domains
5. **XHR Violation** - Tests making XHR requests to non-allowed domains
6. **Eval Violation** - Tests scripts with `eval` present

Each example will automatically trigger a CSP violation when the page loads, which will be reported to your configured CSP endpoint.

## How it Works

The server sets a Content Security Policy header that restricts what resources can be loaded. When a resource violates this policy, the browser will send a report to the specified `report-uri` endpoint.

This playground is useful for testing how CSP violation reports are processed by your PostHog instance. 