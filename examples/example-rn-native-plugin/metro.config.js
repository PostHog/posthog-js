const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// The @posthog/react-native-plugin dep is a symlink to the in-repo package, which
// lives outside this app's dir; Metro must watch it to resolve/bundle it.
const pluginRoot = path.resolve(
  __dirname,
  '../../packages/react-native-plugin',
);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [pluginRoot],
  resolver: {
    // The plugin lives outside this app, so its own bare imports (react-native,
    // react) must resolve back to this app's single copy in node_modules.
    extraNodeModules: new Proxy(
      {},
      {get: (_, name) => path.resolve(__dirname, 'node_modules', String(name))},
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
