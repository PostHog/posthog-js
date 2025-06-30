const apiExtractor = require('@microsoft/api-extractor-model');
const utils = require('./utils');
const apiExtractorUtils = require('./api-extractor-utils');
const { writeFileSync, readFileSync } = require('fs');
const path = require('path');
const { NO_DOCS_TYPES, HOG_REF, SPEC_INFO, OUTPUT_FILE_PATH } = require('./constants');
const { PROPERTIES_EXAMPLE } = require('./constants');


// Load package.json for version number
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

// Load the API model from the JSON file
// Run `pnpm run gen-specs` to generate the API model
const apiPackage = apiExtractor.ApiPackage.loadFromJsonFile('docs/posthog-js.api.json');

// Get the entry points and find the PostHog class
// TODO: we can handle all exposed classes in the future
const entryPoints = apiPackage.entryPoints;
const posthogClass = entryPoints[0].members.find((member: any) =>
    member.kind === apiExtractor.ApiItemKind.Class && member.name === 'PostHog'
);

const methods = posthogClass?.members.filter((member: any) =>
    member.kind === apiExtractor.ApiItemKind.Method && !member.name.startsWith('_')
);

// Extract method information directly in the final format
const functions = methods?.map((method: any) => {
    const returnType = method.returnTypeExcerpt?.text || 'any';

    return {
        category: apiExtractorUtils.extractCategoryTags(method) || '',
        description: apiExtractorUtils.getDocComment(method),
        details: apiExtractorUtils.getRemarks(method),
        id: method.name,
        showDocs: true,
        title: method.name,
        examples: apiExtractorUtils.extractExampleTags(method),
        releaseTag: apiExtractorUtils.isMethodDeprecated(method) ? 'deprecated' : apiExtractorUtils.getMethodReleaseTag(method),
        params: method.parameters.map((param: any) => {
            const paramType = param.parameterTypeExcerpt?.text || 'any';
            return {
                description: apiExtractorUtils.getParamDescription(method, param.name) || '',
                isOptional: param.isOptional || false,
                type: paramType || '',
                name: param.name || ''
            };
        }),
        returnType: {
            id: returnType,
            name: returnType
        },
        ...(posthogClass.fileUrlPath ? { path: posthogClass.fileUrlPath } : {})
    };
}) || [];

// Resolve type definitions (now returns final format)
const types = apiExtractorUtils.resolveTypeDefinitions(apiPackage);

const properties = types.map((type: any) => {
    if (type.name === 'Properties') {
        return {
            ...type,
            example: PROPERTIES_EXAMPLE
        };
    }
    return type;
});

// Compose the output to match the GraphQL query structure
const output = {
    // Classes section (for this script, we only have one class: PostHog)
    id: SPEC_INFO.id,
    hogRef: HOG_REF,
    info: {
        version: packageJson.version,
        ...SPEC_INFO
    },
    noDocsTypes: NO_DOCS_TYPES,
    classes: [
        {
            description: apiExtractorUtils.getDocComment(posthogClass),
            id: posthogClass?.name || 'PostHog',
            title: posthogClass?.name || 'PostHog',
            functions: functions
        }
    ],
    // Types section
    types: types
};

writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(output, null, 2));


