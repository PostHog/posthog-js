module.exports = {
  plugins: ['babel-plugin-transform-import-meta'],
  presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-typescript'],
}
