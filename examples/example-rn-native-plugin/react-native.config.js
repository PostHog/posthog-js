const path = require('path');
// The plugin lives in the monorepo at packages/react-native-plugin.
// This example resolves it from there so the native code builds against
// local source rather than a published npm version.
const pkg = require('../../packages/react-native-plugin/package.json');

module.exports = {
  project: {
    ios: {
      automaticPodsInstallation: true,
    },
  },
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..', '..', 'packages', 'react-native-plugin'),
      platforms: {
        // Required so autolinking codegen detects the locally-linked
        // dependency on iOS, Android, and macOS.
        ios: {},
        android: {},
        macos: {},
      },
    },
  },
};
