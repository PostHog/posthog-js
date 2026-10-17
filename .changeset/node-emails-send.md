---
'posthog-node': minor
---

Add `posthog.emails.send()` to send transactional email from a template uploaded to PostHog by its key, or in Node.js from an HTML template file in your repository, which PostHog keeps in sync through a content hash. A template file upload records its repository, its path in the repository and its commit, from GitHub Actions, GitLab CI, Vercel or Railway variables, or else from the git checkout.
