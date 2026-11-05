---
'@posthog/mcp': patch
---

Reworded the descriptions of the injected `conversation_id` and `llm_model` arguments and the `get_more_tools` and `send_feedback` virtual tools so they describe the field instead of instructing the model. This changes your published tool definitions; if your server is listed in the ChatGPT or Claude directories, those platforms may re-review the updated tools.
