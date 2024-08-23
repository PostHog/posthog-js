module.exports = {
    src: './testcafe',
    compilerOptions: {
        typescript: {
            customCompilerModulePath: require.resolve('typescript'),
        },
    },
}
