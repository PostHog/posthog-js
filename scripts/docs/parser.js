const apiExtractor = require('@microsoft/api-extractor-model');
const documentation = require('./documentation');
const examples = require('./examples');
const methods = require('./methods');
const types = require('./types');
const { writeFileSync, readFileSync } = require('fs');
const path = require('path');

const loadPackageInfo = (packageDir) => 
    JSON.parse(readFileSync(path.resolve(packageDir, 'package.json'), 'utf8'));

const loadApiPackage = (filePath) => 
    apiExtractor.ApiPackage.loadFromJsonFile(filePath);

const findPostHogClass = (apiPackage) =>
    apiPackage.entryPoints[0].members.find(member =>
        member.kind === apiExtractor.ApiItemKind.Class && member.name === 'PostHog'
    );

// Enhance types with examples
const enhanceTypeWithExample = (type, config) => {
    return config.typeExamples[type.name] 
        ? { ...type, example: config.typeExamples[type.name] }
        : type;
};

// Filter public methods
const filterPublicMethods = (posthogClass) =>
    posthogClass?.members.filter(member =>
        member.kind === apiExtractor.ApiItemKind.Method && !member.name.startsWith('_')
    ) || [];

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
        params: method.parameters.map(transformParameter(method)),
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
const composeOutput = (packageJson, posthogClass, functions, types, config) => ({
    id: config.id,
    hogRef: config.hogRef,
    info: {
        version: packageJson.version,
        ...config.specInfo
    },
    classes: [createClassDefinition(posthogClass, functions)],
    types,
    // Set with most important categories first
    categories: [...new Set(['Initialization', 'Identification', 'Capture', ...functions.map(f => f.category).filter(Boolean)])]
});

const generateApiSpecs = (config) => {
    const packageJson = loadPackageInfo(config.packageDir);
    const apiPackage = loadApiPackage(config.apiJsonPath);
    const posthogClass = findPostHogClass(apiPackage);
    
    const resolvedTypes = types
        .resolveTypeDefinitions(apiPackage)
        .map(type => enhanceTypeWithExample(type, config));
    
    const methods = filterPublicMethods(posthogClass);
    const functions = methods.map(transformMethod(posthogClass));
    
    const output = composeOutput(packageJson, posthogClass, functions, resolvedTypes, config);
    
    writeFileSync(config.outputPath, JSON.stringify(output, null, 2));
    
    return output;
};

module.exports = {
    generateApiSpecs
};