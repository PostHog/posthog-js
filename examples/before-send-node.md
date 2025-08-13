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

## Common Use Cases

### 1. Remove Sensitive Data

```javascript
before_send: (event) => {
    const sensitiveKeys = ['password', 'credit_card', 'ssn', 'api_key']

    if (event.properties) {
        sensitiveKeys.forEach((key) => {
            delete event.properties[key]
        })
    }

    return event
}
```

### 2. PII Redaction

```javascript
before_send: (event) => {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g

    function redactPII(obj) {
        if (typeof obj === 'string') {
            return obj.replace(emailRegex, '[REDACTED_EMAIL]')
        }
        if (typeof obj === 'object' && obj !== null) {
            const redacted = {}
            for (const [key, value] of Object.entries(obj)) {
                redacted[key] = redactPII(value)
            }
            return redacted
        }
        return obj
    }

    if (event.properties) {
        event.properties = redactPII(event.properties)
    }

    return event
}
```

### 3. Event Sampling

```javascript
before_send: (event) => {
    const sampleRates = {
        $pageview: 0.1, // 10% of pageviews
        button_clicked: 0.5, // 50% of button clicks
        error: 1.0, // 100% of errors
    }

    const rate = sampleRates[event.event] || 1.0

    if (Math.random() > rate) {
        return null
    }

    return event
}
```

### 4. Add Context

```javascript
before_send: (event) => {
    event.properties = {
        ...event.properties,
        app_version: process.env.APP_VERSION,
        deployment_env: process.env.NODE_ENV,
        server_id: process.env.HOSTNAME,
        node_version: process.version,
    }

    return event
}
```

### 5. Transform Event Names

```javascript
before_send: (event) => {
    // Convert snake_case to camelCase
    event.event = event.event.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase())

    return event
}
```

## Best Practices

1. **Keep it fast**: The `before_send` function runs synchronously for every event. Avoid heavy computations or I/O operations.

2. **Handle errors gracefully**: Wrap your logic in try-catch blocks to prevent errors from breaking event capture:

```javascript
before_send: (event) => {
    try {
        // Your logic here
        return event
    } catch (error) {
        console.error('Error in before_send:', error)
        // Return the original event on error
        return event
    }
}
```

3. **Be mindful of null checks**: Always check if properties exist before accessing them:

```javascript
before_send: (event) => {
    if (event.properties?.user?.email) {
        event.properties.user.email = '[REDACTED]'
    }
    return event
}
```

4. **Log dropped events in development**: Help with debugging by logging when events are dropped:

```javascript
before_send: (event) => {
    if (shouldDropEvent(event)) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`Dropping event: ${event.event}`)
        }
        return null
    }
    return event
}
```

## Migration from Browser SDK

If you're migrating from the PostHog browser SDK, the `before_send` API is identical. The same function signatures and behavior apply, making it easy to share logic between your frontend and backend implementations.

## TypeScript Support

The `before_send` feature is fully typed. Here's an example with TypeScript:

```typescript
import { PostHog, BeforeSendFn, EventMessage } from 'posthog-node'

const beforeSend: BeforeSendFn = (event: EventMessage | null): EventMessage | null => {
    if (!event) return null

    // Your logic here
    return event
}

const posthog = new PostHog('YOUR_API_KEY', {
    host: 'https://us.i.posthog.com',
    before_send: beforeSend,
})
```

## Comparison with Other Methods

| Method           | Use Case                    | When to Use                                     |
| ---------------- | --------------------------- | ----------------------------------------------- |
| `before_send`    | Modify/filter all events    | Global transformations, PII redaction, sampling |
| Event properties | Add data to specific events | Event-specific context                          |
| `register()`     | Add persistent properties   | User traits, session data                       |
| Feature flags    | Control behavior            | A/B testing, gradual rollouts                   |

The `before_send` feature complements these other methods by providing a centralized place to process all events before they leave your application.
