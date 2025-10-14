# Cross-Browser Attribution with Session Property Bootstrapping

This guide explains how to preserve user sessions and attribution data across different browsers, domains, or devices using PostHog's session bootstrapping features.

## The Problem

When users navigate between different websites (e.g., from a marketing site to a booking platform) or open links in different browsers, PostHog normally creates a new session with a new user ID. This breaks:

- User journey tracking across domains
- Attribution data (UTM parameters, referrer information)
- Conversion funnels that span multiple sites

## The Solution

PostHog's bootstrap functionality allows you to:

1. Continue the same user session across browsers/domains (insights & reports work correctly)
2. Preserve attribution data in PostHog's backend session table
3. Maintain the user's identified/anonymous state
4. Optionally preserve session properties on the client for debugging and event-level visibility

## Quick Start

### Enable Bootstrap from URL

Initialize PostHog with URL bootstrapping enabled:

```javascript
posthog.init('YOUR_PROJECT_TOKEN', {
    api_host: 'https://app.posthog.com',
    enable_bootstrap_from_url: true
})
```

### Generate a Tracking URL

When a user is about to navigate to another domain or open a new browser:

```javascript
// Get current session data
const distinctId = posthog.get_distinct_id()
const sessionId = posthog.get_session_id()
const isIdentified = posthog.isIdentified()
const sessionProps = posthog.get_session_properties()

// Build the tracking URL
const url = new URL('https://booking.example.com')
url.searchParams.set('__ph_distinct_id', distinctId)
url.searchParams.set('__ph_session_id', sessionId)
url.searchParams.set('__ph_is_identified', isIdentified ? 'true' : 'false')

// Add session properties to preserve attribution
Object.entries(sessionProps).forEach(([key, value]) => {
    if (key.startsWith('$session_entry_')) {
        const paramName = '__ph_session_entry_' + key.replace('$session_entry_', '')
        url.searchParams.set(paramName, String(value))
    }
})

// Use this URL for navigation
window.location.href = url.toString()
```

### Result

When the user opens this URL (even in a different browser or device), PostHog will:

- Continue the same session with the same `distinct_id` and `session_id`
- Preserve all attribution data (UTM parameters, referrer, etc.)
- Maintain whether the user was identified or anonymous

## Session Properties

Session properties are attribution-related properties that are attached to **all events** in a session. They include:

- `$session_entry_utm_source` - Where the user came from (e.g., "google", "facebook")
- `$session_entry_utm_campaign` - Marketing campaign name
- `$session_entry_utm_medium` - Marketing medium (e.g., "cpc", "email")
- `$session_entry_utm_content` - Campaign content identifier
- `$session_entry_utm_term` - Search keywords
- `$session_entry_referrer` - Full referrer URL
- `$session_entry_referring_domain` - Domain that referred the user
- `$session_entry_url` - The URL where the session started
- And more…

### Get Current Session Properties

```javascript
const sessionProps = posthog.get_session_properties()
console.log(sessionProps)
// {
//   $session_entry_utm_source: 'google',
//   $session_entry_utm_campaign: 'summer_sale',
//   $session_entry_utm_medium: 'cpc',
//   $session_entry_referring_domain: 'google.com',
//   ...
// }
```

## Understanding Session Data vs Session Properties

This is an important distinction that affects what you need to bootstrap:

### Backend Session Data (Always Works with `distinct_id` + `session_id`)

When you bootstrap just `distinct_id` and `session_id`, PostHog's backend session table automatically stores the correct attribution data from the original session, including:

- `initial_utm_source`, `initial_utm_campaign`, `initial_utm_medium`, etc.
- `initial_referring_domain`
- `entry_url`
- Device and location information

**This means session-based insights and reports work correctly without bootstrapping session properties!**

The backend associates all events with the correct session record, which already contains the attribution data.

### Client-Side Session Properties (Optional for Debugging & Visibility)

Bootstrapping session properties via `__ph_session_entry_*` URL parameters provides:

1. **Client-side visibility**: `posthog.get_session_properties()` returns the correct values
2. **Event-level properties**: `$session_entry_utm_source` etc. appear on individual events in the event stream
3. **Debugging**: You can inspect attribution data in debug tools and event viewers
4. **Client-side logic**: Use session properties for conditional rendering, routing, or analytics

### When to Use Each Approach

**Minimal approach (insights & reports only):**

If you only care about insights, funnels, and session-based reports working correctly:

```javascript
// Just bootstrap distinct_id and session_id
url.searchParams.set('__ph_distinct_id', posthog.get_distinct_id())
url.searchParams.set('__ph_session_id', posthog.get_session_id())
// ✅ Insights and session-based reports will work correctly!
```

**Full approach (debugging + client-side visibility):**

If you also need to debug attribution or use session properties in your application:

```javascript
// Also bootstrap session properties
const sessionProps = posthog.get_session_properties()
Object.entries(sessionProps).forEach(([key, value]) => {
    if (key.startsWith('$session_entry_')) {
        const paramName = '__ph_session_entry_' + key.replace('$session_entry_', '')
        url.searchParams.set(paramName, String(value))
    }
})
// ✅ Client-side state matches backend + event properties visible for debugging
```

### Use Session Property Bootstrapping When:

- You need to **debug attribution issues** by inspecting individual events
- Your **application logic depends on session properties** (e.g., showing different content based on UTM source)
- You want **consistency between client-side state and backend data**
- You're using session properties in **client-side analytics or tracking**
- You need to **verify attribution in real-time** during development

## URL Parameter Format

PostHog reads the following URL parameters when `enable_bootstrap_from_url` is enabled:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `__ph_distinct_id` | User's distinct ID | `user-123` |
| `__ph_session_id` | Session identifier | `abc123xyz` |
| `__ph_is_identified` | Whether user is identified | `true` or `false` |
| `__ph_session_entry_utm_source` | UTM source | `google` |
| `__ph_session_entry_utm_campaign` | UTM campaign | `summer_sale` |
| `__ph_session_entry_utm_medium` | UTM medium | `cpc` |
| `__ph_session_entry_*` | Any session property | Any value |

Example URL:

```
https://booking.example.com/?__ph_distinct_id=user-123&__ph_session_id=abc123xyz&__ph_is_identified=true&__ph_session_entry_utm_source=google&__ph_session_entry_utm_campaign=summer_sale&__ph_session_entry_utm_medium=cpc
```

## Advanced Usage

### Explicit Bootstrap Configuration

You can also bootstrap PostHog programmatically without URL parameters:

```javascript
posthog.init('YOUR_PROJECT_TOKEN', {
    api_host: 'https://app.posthog.com',
    bootstrap: {
        distinctID: 'user-123',
        sessionID: 'abc123xyz',
        isIdentifiedID: true,
        sessionProps: {
            $session_entry_utm_source: 'google',
            $session_entry_utm_campaign: 'summer_sale',
            $session_entry_utm_medium: 'cpc'
        }
    }
})
```

**Note:** Explicit bootstrap configuration takes priority over URL parameters.

### Priority Order

When multiple bootstrap sources are available, PostHog uses this priority:

1. **Explicit `bootstrap` config** (highest priority)
2. **URL parameters** (if `enable_bootstrap_from_url: true`)
3. **Existing persistence** (stored in cookies/localStorage)
4. **Generated values** (lowest priority)

## Real-World Example

### Scenario: Marketing Site → Booking Platform

**Marketing Site** (`https://marketing.example.com`):

User lands from Google Ads with UTM parameters:

```
https://marketing.example.com/?utm_source=google&utm_campaign=summer_sale&utm_medium=cpc
```

PostHog captures these automatically as session properties.

When user clicks "Book Now", build a tracking URL:

```javascript
// On marketing site
function buildBookingLink() {
    const sessionProps = posthog.get_session_properties()
    const url = new URL('https://booking.example.com')

    url.searchParams.set('__ph_distinct_id', posthog.get_distinct_id())
    url.searchParams.set('__ph_session_id', posthog.get_session_id())
    url.searchParams.set('__ph_is_identified', posthog.isIdentified() ? 'true' : 'false')

    Object.entries(sessionProps).forEach(([key, value]) => {
        if (key.startsWith('$session_entry_')) {
            const paramName = '__ph_session_entry_' + key.replace('$session_entry_', '')
            url.searchParams.set(paramName, String(value))
        }
    })

    return url.toString()
}

document.querySelector('#book-button').href = buildBookingLink()
```

**Booking Site** (`https://booking.example.com`):

Initialize PostHog with bootstrap enabled:

```javascript
// On booking site
posthog.init('YOUR_PROJECT_TOKEN', {
    api_host: 'https://app.posthog.com',
    enable_bootstrap_from_url: true
})
```

Now all events on the booking site will:

- Be attributed to the same user
- Maintain the same session
- Include the original UTM parameters from the marketing site

### Result in PostHog

All events from both sites appear as a single user journey with consistent attribution:

```
User: user-123
Session: abc123xyz

Events:
1. $pageview (marketing.example.com) - utm_source: google, utm_campaign: summer_sale
2. clicked_book_now (marketing.example.com) - utm_source: google, utm_campaign: summer_sale
3. $pageview (booking.example.com) - utm_source: google, utm_campaign: summer_sale
4. completed_booking (booking.example.com) - utm_source: google, utm_campaign: summer_sale
```

## Testing

You can test this functionality using the playground demo:

1. Start the Next.js playground: `cd packages/browser/playground/nextjs && pnpm dev`
2. Navigate to `/cross-browser-attribution`
3. Click "Generate Tracking URL"
4. Copy the URL and open it in an incognito window or different browser
5. Verify the session continues with the same IDs and properties

## Best Practices

1. **Start minimal, add as needed**: Begin by bootstrapping only `distinct_id` and `session_id` for most use cases. Add session properties only if you need client-side visibility or debugging capabilities.

2. **Clean up URLs**: Use `window.history.replaceState()` to remove bootstrap parameters after initialization:

   ```javascript
   if (window.location.search.includes('__ph_distinct_id')) {
       window.history.replaceState({}, '', window.location.pathname)
   }
   ```

3. **URL encoding**: Session property values are automatically URL-decoded, so special characters are handled correctly.

4. **Security**: Bootstrap parameters are not sensitive (they're already in PostHog), but be mindful of URL length limits (~2000 characters in most browsers).

5. **Selective bootstrapping**: Only bootstrap session properties that matter for your use case to keep URLs shorter. Remember: insights and reports work without them!

## API Reference

### `posthog.get_session_properties()`

Returns the current session properties as an object.

**Returns:** `Record<string, any>`

**Example:**

```javascript
const props = posthog.get_session_properties()
// {
//   $session_entry_utm_source: 'google',
//   $session_entry_utm_campaign: 'summer_sale',
//   ...
// }
```

### Config: `enable_bootstrap_from_url`

**Type:** `boolean`

**Default:** `false`

When `true`, PostHog reads bootstrap data from URL parameters.

### Config: `bootstrap`

**Type:** `BootstrapConfig`

Explicitly provides bootstrap data.

**Fields:**

- `distinctID?: string` - User's distinct ID
- `sessionID?: string` - Session identifier
- `isIdentifiedID?: boolean` - Whether user is identified
- `sessionProps?: Record<string, any>` - Session entry properties

## Troubleshooting

### My insights show correct attribution but event properties don't

**This is expected!** PostHog's backend session table has the correct attribution data when you bootstrap `distinct_id` and `session_id`. Session property bootstrapping is only needed for client-side visibility and event-level properties.

**Solution**: If you need event properties for debugging, add session property bootstrapping via `__ph_session_entry_*` URL parameters.

### Session properties not appearing on events

- Ensure `enable_bootstrap_from_url: true` is set on the destination site
- Check that URL parameters start with `__ph_session_entry_`
- Verify the parameter names match PostHog's format (e.g., `__ph_session_entry_utm_source`)
- Remember: You need to explicitly add `__ph_session_entry_*` params to your URLs (they're not added automatically)

### URL too long

- Use the minimal approach: only bootstrap `distinct_id` and `session_id` (insights will still work!)
- If you need session properties, only include essential ones
- Consider using server-side URL shortening
- Use explicit `bootstrap` config instead of URL parameters

### Properties from wrong session

- Explicit `bootstrap` config overrides URL parameters
- Check initialization order and ensure URL parameters are read first

### Insights work but `get_session_properties()` returns empty/wrong values

**This is expected!** Backend data is correct, but client-side state isn't synchronized.

**Solution**: Add session property bootstrapping to keep client-side state in sync with backend data.

## See Also

- [PostHog Session Recording](https://posthog.com/docs/session-replay)
- [Feature Flags](https://posthog.com/docs/feature-flags)
- [Identity Management](https://posthog.com/docs/integrate/identifying-users)
