const { ReleaseTag, ApiItemKind } = require('@microsoft/api-extractor-model');

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

const { findTypeInPackage, getInheritanceChain } = require('./inheritance');

/**
 * Collect all public methods from a class and its inheritance chain
 * @param {any} posthogClass - Starting class
 * @returns {any[]} - Array of unique public methods
 */
const collectMethodsWithInheritance = (posthogClass) => {
    if (!posthogClass) return [];
    
    const allMethods = new Map();
    const apiPackage = posthogClass.getAssociatedPackage();
    const inheritanceChain = getInheritanceChain(posthogClass, apiPackage);
    
    // Collect methods from each class in the inheritance chain
    for (const currentClass of inheritanceChain) {
        const inheritanceResult = currentClass.findMembersWithInheritance();
        const members = inheritanceResult.items || [];
        
        const methods = members.filter(member =>
            member.kind === ApiItemKind.Method && !member.name.startsWith('_')
        );
        
        // Add methods to map (child methods take precedence over parent methods)
        methods.forEach(method => {
            if (!allMethods.has(method.name)) {
                allMethods.set(method.name, method);
            }
        });
    }
    
    return Array.from(allMethods.values());
};

module.exports = {
  getMethodReleaseTag,
  isMethodDeprecated,
  collectMethodsWithInheritance,
};