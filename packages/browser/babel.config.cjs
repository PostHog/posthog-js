module.exports = {
    presets: [
        ['@babel/env', { targets: { node: 'current' } }],
        ['@babel/typescript', { jsxPragma: 'h' }],
    ],
    plugins: [
        '@babel/plugin-transform-nullish-coalescing-operator',
        [
            '@babel/transform-react-jsx',
            {
                runtime: 'automatic',
                importSource: 'preact',
            },
        ],
    ],
}
