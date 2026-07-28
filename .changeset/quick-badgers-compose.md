---
'posthog-react-native': patch
---

Fix iOS Expo source map uploads when another config plugin wraps the React Native bundle phase. After upgrading, projects with a checked-in `ios/` directory should run `npx expo prebuild --platform ios` to migrate the existing bundle phase.
