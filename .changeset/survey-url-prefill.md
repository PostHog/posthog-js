---
"posthog-js": minor
---

feat(surveys): add URL prefill and auto-submit support

Surveys can now be prefilled and automatically submitted via URL parameters.

**New configuration options:**
```javascript
posthog.init('token', {
    surveys: {
        prefillFromUrl: true,
        autoSubmitIfComplete: true,
        autoSubmitDelay: 800,
    }
})
```

**URL format:** `?q0=1&q1=8&auto_submit=true`
- `q{N}` = question index (0-based)
- Value = choice index or rating value
- `auto_submit=true` enables auto-submission

**Supported question types:**
- Single choice (choice index)
- Multiple choice (multiple q{N} params)
- Rating (numeric value, validated against scale)

**Use cases:**
- Pre-filled NPS surveys from email campaigns
- One-click survey responses from notifications
- SMS surveys with embedded feedback
- QR code surveys at events
