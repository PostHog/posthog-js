const path = require('path');
const pkg = require('../package.json');

module.exports = {
  project: {
    ios: {
      automaticPodsInstallation: true,
    },
  },
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..'),
      platforms: {
        // Required so autolinking codegen detects the workspace-linked
        // dependency on iOS and Android.
        ios: {},
        android: {},
      },
    },
  },
};
