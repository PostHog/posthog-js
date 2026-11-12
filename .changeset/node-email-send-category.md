---
'posthog-node': minor
---

`posthog.emails.send()` with `templateKey` takes a `category` that defines the email's message category in code, so marketing email honors opt-outs. A send creates its category when the project has none with that key; the category's name and description apply only then, and you change them later in PostHog. Without a category, the email follows the category of the template that `templateKey` names, or is transactional with no category. A template made in PostHog is transactional, so PostHog refuses a `templateKey` that names a template in a marketing category with `marketing_template`. `TRANSACTIONAL_EMAIL_CATEGORY` asks for transactional email with no category, so PostHog refuses it with `category_mismatch` on a template in a category.
