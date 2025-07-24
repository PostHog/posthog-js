# To run the example, you need to have the following installed (with yarn works as well)

- sudo gem install cocoapods
- npm install --global yarn
- npm install --global rollup

# Run the example

```bash
yarn install
cd ios
pod install
cd ..
yarn start
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
