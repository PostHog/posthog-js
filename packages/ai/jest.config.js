module.exports = {
  collectCoverage: true,
  clearMocks: true,
  coverageDirectory: 'coverage',
  silent: true,
  verbose: false,
  transformIgnorePatterns: ['/node_modules/(?!.*(p-retry|is-network-error)/)'],
}
