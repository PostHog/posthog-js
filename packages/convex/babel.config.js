module.exports = {
  presets: [['@babel/preset-env', { targets: { node: '20.0' }, modules: false }], '@babel/preset-typescript'],
  plugins: ['./babel-plugin-import-meta-glob.cjs'],
}
