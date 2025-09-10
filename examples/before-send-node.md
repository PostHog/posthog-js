# Using `before_send` in PostHog Node.js SDK

The `before_send` feature allows you to modify or drop events before they are sent to PostHog. This is useful for:

- Filtering out sensitive data
- Sampling events
- Adding metadata to all events
- Transforming event data
- Implementing custom business logic

## Basic Usage

Pass a `before_send` function to the PostHog constructor:

```javascript
const { PostHog } = require('posthog-node')

const posthog = new PostHog('YOUR_API_KEY', {
    host: 'https://us.i.posthog.com',

    before_send: (event) => {
        // Modify the event
        event.properties = {
            ...event.properties,
            processed_by: 'node-sdk',
        }

        // Return the modified event
        return event
    },
})
```

## Dropping Events

Return `null` to drop an event completely:

```javascript
const posthog = new PostHog('YOUR_API_KEY', {
    host: 'https://us.i.posthog.com',

    before_send: (event) => {
        // Drop all events from test environments
        if (event.properties?.environment === 'test') {
            return null
        }

        return event
    },
})
```

## Multiple Functions

You can provide an array of `before_send` functions. They will be executed in order, with each function receiving the output of the previous one:

```javascript
const posthog = new PostHog('YOUR_API_KEY', {
    host: 'https://us.i.posthog.com',

    before_send: [
        // First: Add metadata
        (event) => {
            event.properties = {
                ...event.properties,
                server_region: process.env.AWS_REGION,
                timestamp: Date.now(),
            }
            return event
        },

        // Second: Filter sensitive data
        (event) => {
            if (event.properties?.password) {
                delete event.properties.password
            }
            return event
        },

        // Third: Sample events
        (event) => {
            // Only send 10% of pageview events
            if (event.event === '$pageview' && Math.random() > 0.1) {
                return null
            }
            return event
        },
    ],
})
```

## Event Structure

The `event` parameter passed to `before_send` contains:

```typescript
{
  distinctId: string,           // The user's distinct ID
  event: string,               // The event name
  properties?: object,         // Event properties
  groups?: object,            // Group identifiers
  sendFeatureFlags?: boolean, // Whether to send feature flags
  timestamp?: Date,           // Event timestamp
  disableGeoip?: boolean,     // Whether to disable GeoIP
  uuid?: string              // Event UUID
}
```
