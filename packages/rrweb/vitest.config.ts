export default {
  test: {
    /**
     * Keeps old (pre-jest 29) snapshot format
     * it's a bit ugly and harder to read than the new format,
     * so we might want to remove this in its own PR
     */
    snapshotFormat: {
      escapeString: true,
      printBasicPrototype: true,
    },
    retry: process.env.CI ? 2 : 0,
  },
};
