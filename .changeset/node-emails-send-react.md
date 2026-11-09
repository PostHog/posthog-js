---
'posthog-node': minor
---

`posthog.emails.send()` now takes a React Email element as `react`, so you no longer render it yourself. The client renders it into `html`, and into `text` when you pass none.

```tsx
import { WelcomeEmail } from './emails/welcome'

const { data, error } = await posthog.emails.send({
    to: 'ada@example.com',
    distinctId: 'user_123',
    templateKey: 'welcome',
    subject: 'Welcome to Acme',
    react: <WelcomeEmail firstName="Ada" />,
})
```

Rendering needs the `@react-email/render` package, which the `react-email` package and Resend's SDK use too. Install it next to `posthog-node`. It is an optional peer dependency, and posthog-node loads it only when a send has `react`. Without it, that send returns an `EmailError` with the code `missing_react_renderer` and sends nothing. A send with `react` takes no `html`.
