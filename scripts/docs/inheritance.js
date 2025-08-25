const apiExtractor = require('@microsoft/api-extractor-model');

/**
 * Finds a class or interface by name in the API package
 * @param {string} typeName - Name of the type to find
 * @param {any} apiPackage - API package to search in
 * @returns {any|null} - Found class/interface or null
 */
const findTypeInPackage = (typeName, apiPackage) => {
    for (const entryPoint of apiPackage.entryPoints) {
        for (const member of entryPoint.members) {
            if (member.name === typeName && member.kind === apiExtractor.ApiItemKind.Class) {
                return member;
            }
        }
    }
    return null;
};

/**
 * Recursively traverses inheritance chain and collects all classes
 * @param {any} startClass - Class to start traversal from
 * @param {any} apiPackage - API package for resolving parent classes
 * @returns {any[]} - Array of classes in inheritance chain (child to parent order)
 */
const getInheritanceChain = (startClass, apiPackage) => {
    const chain = [];
    
    const traverseInheritance = (currentClass) => {
        if (!currentClass || chain.includes(currentClass)) return;
        
        chain.push(currentClass);
        
        // Process parent class
        if (currentClass.extendsType?.excerpt) {
            const parentTypeName = currentClass.extendsType.excerpt.text.trim();
            const parentClass = findTypeInPackage(parentTypeName, apiPackage);
            if (parentClass) {
                traverseInheritance(parentClass);
            }
        }
    };
    
    traverseInheritance(startClass);
    return chain;
};

module.exports = {
    findTypeInPackage,
    getInheritanceChain
};