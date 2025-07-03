module.exports = {
  plugins: [
    // Silence babel warnings
    ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    ['@babel/plugin-transform-private-methods', { loose: true }],
    ['@babel/plugin-transform-class-properties', { loose: true }],
  ],
  presets: ['@react-native/babel-preset', '@babel/env', '@babel/preset-typescript'],
}
