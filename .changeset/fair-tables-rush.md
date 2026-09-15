---
'@posthog/core': patch
'posthog-js': patch
'posthog-react-native': patch
---

Share survey choice and question shuffling between web and React Native through surveys core. Use Fisher-Yates for web questions, preserve Other-last choice ordering, and avoid mutating configured choices.
