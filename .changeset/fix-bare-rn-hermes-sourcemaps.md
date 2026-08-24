---
'posthog-react-native': patch
---

Fix bare React Native Hermes sourcemap Chunk ID generation in the Metro serializer. Requires posthog-cli >= 0.14.1 to clone and upload the generated camel-case `chunkId` metadata.
