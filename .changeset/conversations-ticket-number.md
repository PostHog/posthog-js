---
'posthog-js': minor
---

Surface the human-readable ticket number in the conversations/support API. `Ticket`, `SendMessageResponse`, and `GetMessagesResponse` now include an optional `ticket_number`, and a new `posthog.conversations.getCurrentTicketNumber()` returns it for the active ticket (persisted across reloads). Use this instead of the ticket UUID when displaying a reference users can quote externally.
