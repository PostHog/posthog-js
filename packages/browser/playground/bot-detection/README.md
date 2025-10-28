# Bot Detection Playground

A simple playground for testing PostHog's bot detection and pageview collection features.

## Features

This playground demonstrates:

- Bot detection using user agent filtering
- `__preview_send_bot_pageviews` preview flag
- `$bot_pageview` event generation for bot traffic
- `$browser_type` property on bot pageviews
- Interactive testing UI with buttons
- Real-time console logging of all events

## Setup

### Environment Variables (Optional)

Create a `.env` file in this directory:

```bash
POSTHOG_TOKEN=your_posthog_project_api_key
POSTHOG_API_HOST=https://us.i.posthog.com
POSTHOG_UI_HOST=https://us.i.posthog.com
```

If not provided, the app will use default test values that work locally.

### Installation

```bash
npm install
```

## Running the Playground

```bash
npm run dev
```

Or with pnpm (from the playground directory):

```bash
pnpm dev
```

This will start the Express server on http://localhost:8080

## How to Use

### Method 1: Using Browser DevTools (Recommended)

1. Open the playground at http://localhost:8080
2. Open DevTools (F12) and go to the Console tab
3. Open **Network Conditions**:
    - Click the 3-dot menu in Console
    - More tools → Network conditions
4. Under "User agent":
    - Uncheck "Use browser default"
    - Select "Custom..."
    - Enter a bot user agent (see list below)
5. **Refresh the page** (important!)
6. Click "Send $pageview Event"
7. Check the Console output to verify:
    - Event name is `$bot_pageview` (not `$pageview`)
    - Properties include `$browser_type: 'bot'`

### Common Bot User Agents

- `Googlebot/2.1`
- `facebookexternalagent`
- `Twitterbot/1.0`
- `LinkedInBot/1.0`
- `Chrome-Lighthouse`
- `HeadlessChrome/91.0.4472.124`

### Method 2: Using curl

```bash
# Simulate a bot pageview
curl 'http://localhost:8080' -H 'User-Agent: Googlebot/2.1' -v
```

## What to Observe

### When `__preview_send_bot_pageviews: true` (Default)

- **Bot traffic**: Pageviews renamed to `$bot_pageview` with `$browser_type: 'bot'`
- **Normal traffic**: Pageviews remain as `$pageview` without `$browser_type`
- **Other events**: Sent normally regardless of user agent

### When `__preview_send_bot_pageviews: false`

- **Bot traffic**: All events dropped (default PostHog behavior)
- **Normal traffic**: All events sent normally

## Interactive Features

The playground includes buttons to:

1. **Send $pageview Event** - Manually trigger a pageview event
2. **Send Custom Event** - Test non-pageview events from bots
3. **Toggle \_\_preview_send_bot_pageviews** - Reinitialize PostHog with/without the flag

## Console Output

With debug mode enabled (default), you'll see detailed logging in the browser console:

```javascript
[PostHog.js] send "$bot_pageview" {
  event: "$bot_pageview",
  properties: {
    $browser_type: "bot",
    $current_url: "http://localhost:8080",
    // ... other properties
  }
}
```

## Troubleshooting

**Events not showing in console?**

- PostHog debug mode is enabled automatically
- Check that the PostHog instance initialized successfully

**Bot detection not working?**

- Verify you've changed the User Agent in DevTools Network Conditions
- **Refresh the page** after changing the user agent
- Check the console for the actual user agent being used

**Server won't start?**

- Make sure port 8080 is available
- Check that you've run `pnpm install` first
- The built PostHog library should exist at `../../dist/posthog.js`

## Implementation Details

This playground uses the bot detection feature added in the `lricoy/bot-pageview-collection` branch:

- **Browser SDK**: Detects bots and renames pageviews to `$bot_pageview`
- **Preview Flag**: `__preview_send_bot_pageviews` enables bot traffic collection
- **Browser Type Property**: `$browser_type: 'bot'` is set on all `$bot_pageview` events for easy filtering
