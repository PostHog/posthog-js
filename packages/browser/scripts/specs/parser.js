const apiExtractor = require('@microsoft/api-extractor-model');
const documentation = require('./documentation');
const examples = require('./examples');
const methods = require('./methods');
const types = require('./types');
const { writeFileSync, readFileSync } = require('fs');
const path = require('path');
const { HOG_REF, SPEC_INFO, OUTPUT_FILE_PATH, PROPERTIES_EXAMPLE, PROPERTY_EXAMPLE } = require('./constants');

const loadPackageInfo = (dirPath) => 
    JSON.parse(readFileSync(path.resolve(dirPath, '../../package.json'), 'utf8'));

const loadApiPackage = (filePath) => 
    apiExtractor.ApiPackage.loadFromJsonFile(filePath);

const findPostHogClass = (apiPackage) =>
    apiPackage.entryPoints[0].members.find(member =>
        member.kind === apiExtractor.ApiItemKind.Class && member.name === 'PostHog'
    );

// Enhance types with examples
const enhanceTypeWithExample = (type) => {
    const examples = {
        Properties: PROPERTIES_EXAMPLE,
        Property: PROPERTY_EXAMPLE
    };
    
    return examples[type.name] 
        ? { ...type, example: examples[type.name] }
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
const composeOutput = (packageJson, posthogClass, functions, types) => ({
    id: SPEC_INFO.id,
    hogRef: HOG_REF,
    info: {
        version: packageJson.version,
        ...SPEC_INFO
    },
    classes: [createClassDefinition(posthogClass, functions)],
    types,
    categories: [...new Set(functions.map(f => f.category))]
});

const ApiToSpecs = () => {
    const packageJson = loadPackageInfo(__dirname);
    const apiPackage = loadApiPackage('docs/posthog-js.api.json');
    const posthogClass = findPostHogClass(apiPackage);
    
    const resolvedTypes = types
        .resolveTypeDefinitions(apiPackage)
        .map(enhanceTypeWithExample);
    
    const methods = filterPublicMethods(posthogClass);
    const functions = methods.map(transformMethod(posthogClass));
    
    return composeOutput(packageJson, posthogClass, functions, resolvedTypes);
};

const output = ApiToSpecs();
writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(output, null, 2));
