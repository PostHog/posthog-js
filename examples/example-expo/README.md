## Running Detox tests

Ensure you have all necessary deps installed

```
brew tap wix/brew
brew install --HEAD applesimutils
npm install -g expo-cli
npm install -g detox-cli

# If not already run
./e2e/tools/downloadApp.sh
```

Then run expo in one tab and detox in another

```
# Terminal 1
yarn start
# Terminal 2
yarn test

```
