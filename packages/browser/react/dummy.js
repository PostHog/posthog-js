var name = '@posthog/react'
var version = '1.0.0'
var description =
    'Provides components and hooks for React integrations of PostHog. It is not published to NPM, but is used in the main posthog-js package.'
var repository = {
    type: 'git',
    url: 'https://github.com/PostHog/posthog-js',
    directory: 'packages/react',
}
var author = 'hey@posthog.com'
var license = 'MIT'
var homepage = 'https://posthog.com/docs/libraries/react'
var packageManager = 'pnpm@9.15.4'
var scripts = {
    clean: 'rimraf dist',
    build: 'rollup -c rollup.config.ts',
    dev: 'rollup -c rollup.config.ts --watch',
    test: 'jest',
    lint: 'eslint src',
    'test:debug': 'jest --runInBand',
    prepublishOnly: 'pnpm test && pnpm build',
}
var main = 'dist/umd/index.js'
var module = 'dist/esm/index.js'
var types = 'dist/types'
var files = ['dist/*', 'README.md']
var peerDependencies = {
    '@types/react': '>=16.8.0',
    'posthog-js': 'workspace:*',
    react: '>=16.8.0',
}
var peerDependenciesMeta = {
    '@types/react': {
        optional: true,
    },
}
var devDependencies = {
    '@babel/preset-react': '^7.18.6',
    '@posthog-tooling/rollup-utils': 'workspace:*',
    '@rollup/plugin-inject': '^4.0.2',
    '@rollup/plugin-replace': '^2.3.4',
    '@testing-library/jest-dom': '^5.16.5',
    '@testing-library/react': '^11.2.2',
    '@testing-library/react-hooks': '^3.7.0',
    '@types/react': '^17.0.0',
    '@types/testing-library__react-hooks': '^4.0.0',
    'cross-env': '^7.0.3',
    given2: '^2.1.7',
    jest: 'catalog:',
    'jest-environment-jsdom': 'catalog:',
    'posthog-js': 'workspace:*',
    react: '^17.0.1',
    'react-dom': '^17.0.1',
    'react-test-renderer': '^17.0.1',
    rollup: '^2.35.1',
    'rollup-plugin-copy': '^3.5.0',
    tslib: 'catalog:',
    typescript: 'catalog:',
}
var _package = {
    name: name,
    version: version,
    private: true,
    description: description,
    repository: repository,
    author: author,
    license: license,
    homepage: homepage,
    packageManager: packageManager,
    scripts: scripts,
    main: main,
    module: module,
    types: types,
    files: files,
    peerDependencies: peerDependencies,
    peerDependenciesMeta: peerDependenciesMeta,
    devDependencies: devDependencies,
}

export {
    author,
    _package as default,
    description,
    devDependencies,
    files,
    homepage,
    license,
    main,
    module,
    name,
    packageManager,
    peerDependencies,
    peerDependenciesMeta,
    repository,
    scripts,
    types,
    version,
}
