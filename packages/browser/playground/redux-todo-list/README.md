# PostHog State Management Logging Examples

This is a comparison of PostHog logging integrations with different state management libraries using a todo list application built with Next.js.

## Examples Included

- **Redux**: Uses Redux Toolkit with `posthogReduxLogger` middleware
- **Kea**: Uses Kea with `posthogKeaLogger` plugin (cleaner API)

## To run it

```bash
pnpm i && pnpm dev
```

Then visit:

- **Home**: http://localhost:3000/ - Overview and links to examples
- **Redux**: http://localhost:3000/redux - Redux Toolkit + PostHog logging
- **Kea**: http://localhost:3000/kea - Kea + PostHog logging

## Features Demonstrated

- Action and state logging with PostHog
- Rate limiting to prevent log flooding
- State diffing (only log changed values)
- Action/state masking for sensitive data
- Performance monitoring (slow action detection)
- Different API styles (Redux-specific vs generic)

Apologies to the future traveller, the example todo app is entirely AI slop
