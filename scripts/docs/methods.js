const { ReleaseTag } = require('@microsoft/api-extractor-model');

// for release tag mapping
const releaseTagMap = {
  [ReleaseTag.Internal]: 'internal',
  [ReleaseTag.Alpha]: 'alpha',
  [ReleaseTag.Beta]: 'beta',
  [ReleaseTag.Public]: 'public'
};

/**
 * Get method release tag
 * @param {any} apiMethod - API method to get release tag from
 * @returns {string} - Release tag string
 */
const getMethodReleaseTag = (apiMethod) => 
  releaseTagMap[apiMethod.releaseTag] || 'public';

// Deprecation detection functions
const hasDeprecatedBlock = (apiMethod) => 
  apiMethod.tsdocComment?.deprecatedBlock !== undefined;

/**
 * Check if method is deprecated
 * @param {any} apiMethod - API method to check
 * @returns {boolean} - Whether method is deprecated
 */
const isMethodDeprecated = hasDeprecatedBlock;

module.exports = {
  getMethodReleaseTag,
  isMethodDeprecated,
};