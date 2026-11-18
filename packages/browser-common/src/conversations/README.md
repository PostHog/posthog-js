Files in here are intended for the lazy loaded portion of conversations.

SDKs import them through the `conversations-renderer` entrypoint from their lazily loaded conversations code, never from their initial bundles, because they could cause an increase in bundle size.
