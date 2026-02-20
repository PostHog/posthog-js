# Run the example

```bash
# root folder
pnpm build
pnpm package
pnpm package:watch
# example folder
pnpm install
# you can also avoid lockfile changes
pnpm install --no-lockfile
cd ios
pod install
cd ..
pnpm start
```

Press s │ switch to development build.

Open Xcode 16.4

Use [XcodesApp](https://github.com/XcodesOrg/XcodesApp) to install Xcode 16.4.

Open the ios/exampleexpo53.xcworkspace file with Xcode.

Choose an iPhone simulator (eg iPhone 16 - 18.0).

Press the play button in Xcode to run the app.

Or...

```bash
npx expo run:ios
npx expo run:android
npx expo start --web # uncomment "persistence: 'memory'" inside posthog.tsx for it to work
```

If your RN SDK changes are not picked up:

```bash
# example folder
rm -rf node_modules
# repeat Run steps
```

# Build Release mode locally

```bash
# android
cd android
./gradlew assembleRelease

# ios
set -o pipefail && xcrun xcodebuild clean build -workspace ios/exampleexpo53.xcworkspace -scheme exampleexpo53 -configuration Release -destination generic/platform=ios | xcpretty

# Xcode
# Signing and Capabilities -> assign a team
# Also: Xcode -> Product -> Archive

# web
npx expo export --clear --source-maps --platform web

# eject expo (delete and recreate android and ios folders) and test expo plugins
npx expo prebuild --clean
```
