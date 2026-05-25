module.exports = {
    presets: [
        [
            '@babel/env',
            {
                targets: [
                    '> 0.5%, last 2 versions, Firefox ESR, not dead',
                    'chrome > 62',
                    'firefox > 59',
                    'ios_saf >= 6.1',
                    'opera > 50',
                    'safari > 12',
                    'IE 11',
                ],
            },
        ],
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
