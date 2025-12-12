module.exports = {
    presets: [
        ['@babel/preset-env', { targets: { node: '18.0' } }],
        ['@babel/preset-typescript', { allowDeclareFields: true }],
        '@babel/preset-react',
    ],
}
