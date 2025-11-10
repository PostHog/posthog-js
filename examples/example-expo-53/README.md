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
```

If your RN SDK changes are not picked up:

```bash
# example folder
rm -rf node_modules
# repeat Run steps
```

# Build locally

```bash
npm install -g eas-cli
eas build --platform android --local
```
