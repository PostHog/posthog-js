module.exports = {
    src: './testcafe/*.spec.js',
    compilerOptions: {
        typescript: {
            customCompilerModulePath: require.resolve('typescript'),
        },
    },
}
