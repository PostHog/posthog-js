const apiExtractor = require('@microsoft/api-extractor-model');
const documentation = require('./documentation');
const examples = require('./examples');
const methods = require('./methods');
const types = require('./types');
const { writeFileSync, readFileSync } = require('fs');
const path = require('path');

const loadApiPackage = (filePath) => 
    apiExtractor.ApiPackage.loadFromJsonFile(filePath);

const findPostHogClass = (apiPackage, className) =>
    apiPackage.entryPoints[0].members.find(member =>
        member.kind === apiExtractor.ApiItemKind.Class && member.name === className
    );

// Find extra methods (functions/components) from the API package
const findExtraMethods = (apiPackage, extraMethodNames) => {
    if (!extraMethodNames || extraMethodNames.length === 0) {
        return [];
    }
    
    return apiPackage.entryPoints[0].members.filter(member =>
        (member.kind === apiExtractor.ApiItemKind.Function || 
         member.kind === apiExtractor.ApiItemKind.Class) && 
        extraMethodNames.includes(member.name)
    );
};

// Enhance types with examples
const enhanceTypeWithExample = (type, config) => {
    return config.typeExamples[type.name] 
        ? { ...type, example: config.typeExamples[type.name] }
        : type;
};

// Filter public methods
const filterPublicMethods = (posthogClass, parentClass) => 
    methods.collectMethodsWithInheritance(posthogClass, parentClass);

// Transform parameters
const transformParameter = (method) => (param) => ({
    description: documentation.getParamDescription(method, param.name) || '',
    isOptional: param.isOptional || false,
    type: param.parameterTypeExcerpt?.text || 'any',
    name: param.name || ''
});

// Transform methods
const transformMethod = (posthogClass) => (method) => {
    const returnType = method.returnTypeExcerpt?.text || 'any';
    
    return {
        category: documentation.extractCategoryTags(method.tsdocComment) || '',
        description: documentation.getDocComment(method),
        details: documentation.getRemarks(method),
        id: method.name,
        showDocs: true,
        title: method.name,
        examples: examples.extractExampleTags(method),
        releaseTag: methods.isMethodDeprecated(method) ? 'deprecated' : methods.getMethodReleaseTag(method),
        params: (method.parameters || []).map(transformParameter(method)),
        returnType: {
            id: returnType,
            name: returnType
        },
        ...(posthogClass && 'fileUrlPath' in posthogClass ? { path: posthogClass.fileUrlPath } : {})
    };
};

// Create class definition
const createClassDefinition = (posthogClass, functions) => ({
    description: documentation.getDocComment(posthogClass),
    id: posthogClass?.name || 'PostHog',
    title: posthogClass?.name || 'PostHog',
    functions
});

// Compose final output
const composeOutput = (posthogClass, functions, types, config) => ({
    id: config.id,
    hogRef: config.hogRef,
    info: {
        version: config.version,
        ...config.specInfo
    },
    classes: [createClassDefinition(posthogClass, functions)],
    types,
    // Set with most important categories first
    categories: [...new Set(['Initialization', 'Identification', 'Capture', ...functions.map(f => f.category).filter(Boolean)])]
});

const generateApiSpecs = (config) => {
    const apiPackage = loadApiPackage(config.apiJsonPath);
    const posthogClass = findPostHogClass(apiPackage, config.parentClass);
    
    const resolvedTypes = types
        .resolveTypeDefinitions(apiPackage)
        .map(type => enhanceTypeWithExample(type, config));
    
    const methods = filterPublicMethods(posthogClass, config.parentClass);
    const functions = methods.map(transformMethod(posthogClass));
    
    // Process extra methods if specified
    const extraMethods = findExtraMethods(apiPackage, config.extraMethods);
    const providerMethods = extraMethods.map(transformMethod(null));
    
    // Combine regular methods with extra methods
    const allFunctions = [...providerMethods,...functions];
    
    const output = composeOutput(posthogClass, allFunctions, resolvedTypes, config);
    
    return output;
};

module.exports = {
    generateApiSpecs
};