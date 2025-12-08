module.exports = {
  collectCoverage: true,
  clearMocks: true,
  coverageDirectory: 'coverage',
  silent: true,
  verbose: false,
  transformIgnorePatterns: [
    'node_modules/(.pnpm/[^/]+/node_modules/(?!(p-queue|p-timeout|eventemitter3)/)|(?!(.pnpm|p-queue|p-timeout|eventemitter3)/))',
  ],
}
