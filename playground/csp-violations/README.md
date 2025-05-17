# CSP Violations Playground

A development playground for testing CSP violation reports with PostHog.

## Setup

Before running the playground, make sure to update the CSP report endpoint in `server.js`:

```javascript
// UPDATE YOUR TOKEN!!!
const CSP_REPORT_URI = 'http://localhost:8010/csp?token=phc_Pv7thRPMKG4x2lOBamiZHgo5kDW7vuGJeWqp978dlFg'
```

Replace this with your own PostHog instance URL and token.

## Installation

Install the dependencies:

```bash
npm install
```

## Running the Playground

### Standard mode

```bash
npm start
```

### Development mode with hot reload

```bash
npm run dev
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

Each example will automatically trigger a CSP violation when the page loads, which will be reported to your configured CSP endpoint.

## How it Works

The server sets a Content Security Policy header that restricts what resources can be loaded. When a resource violates this policy, the browser will send a report to the specified `report-uri` endpoint.

The current CSP policy is:

```
default-src 'self';
script-src 'self' https://*.posthog.com;
connect-src 'self' https://*.posthog.com;
img-src 'self' data:;
style-src 'self';
report-uri [your-endpoint];
```

This playground is useful for testing how CSP violation reports are processed by your PostHog instance. 