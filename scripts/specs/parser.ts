const apiExtractor = require('@microsoft/api-extractor-model');
const utils = require('./utils');
const { writeFileSync } = require('fs');

// Load the API model from the JSON file
const apiPackage = apiExtractor.ApiPackage.loadFromJsonFile('docs/posthog-js.api.json');

// Get the entry points and find the PostHog class
const entryPoints = apiPackage.entryPoints;
const posthogClass = entryPoints[0].members.find((member: any) =>
    member.kind === apiExtractor.ApiItemKind.Class && member.name === 'PostHog'
);

// Get all the members of the PostHog class that are methods
const methods = posthogClass?.members.filter((member: any) =>
    member.kind === apiExtractor.ApiItemKind.Method && !member.name.startsWith('_')
);

// set of definitions to include in specs
const definitions = new Set()

// Helper function to split and add types to definitions
function addTypeToDefinitions(type: string) {
    if (!type) return;

    // Split union types
    const unionTypes = type.split('|').map(t => t.trim());
    // Split intersection types
    const allTypes = unionTypes.flatMap(t => t.split('&').map(t => t.trim()));

    // Add each type to definitions
    allTypes.forEach(t => {
        if (t && t !== 'any' && t !== 'void' && t !== 'undefined' && t !== 'null') {
            definitions.add(t);
        }
    });
}

// Extract method information
const methodInfo = methods?.map((method: any) => {
    const apiMethod = method;
    const returnType = apiMethod.returnTypeExcerpt?.text || 'any';
    addTypeToDefinitions(returnType);

    return {
        id: apiMethod.name,
        title: apiMethod.name,
        description: utils.getDocComment(apiMethod),
        category: '',
        details: utils.getRemarks(apiMethod),
        showDocs: true,
        returnType: {
            id: returnType,
            name: returnType
        },
        params: apiMethod.parameters.map((param: any) => {
            const paramType = param.parameterTypeExcerpt?.text || 'any';
            addTypeToDefinitions(paramType);
            return {
                name: param.name,
                isOptional: param.isOptional,
                type: paramType,
                description: utils.getParamDescription(apiMethod, param.name)
            };
        }),
        examples: utils.extractExampleTags(apiMethod)
    };
});

// Find all type definitions in the API package
interface TypeDefinition {
    name: string;
    id: string;
    params?: {
        name: string;
        type: string;
        description: string;
    }[];
    path?: string;
}

// Helper function to find a type by its canonical reference
function findTypeByCanonicalReference(apiPackage: any, canonicalReference: any) {
    if (!canonicalReference) return null;

    // Extract the type name from the canonical reference
    const typeName = canonicalReference.toString().split('!')[1];
    if (!typeName) return null;

    for (const entryPoint of apiPackage.entryPoints) {
        for (const member of entryPoint.members) {
            if (member.name === typeName) {
                return member;
            }
        }
    }
    return null;
}

const typeDefinitions: TypeDefinition[] = [];
for (const entryPoint of entryPoints) {
    for (const member of entryPoint.members) {
        if (member.kind === apiExtractor.ApiItemKind.TypeAlias ||
            member.kind === apiExtractor.ApiItemKind.Interface) {
            let path = undefined;
            if (member.fileUrlPath) {
                path = member.fileUrlPath;
            }
            const typeDef: TypeDefinition = {
                name: member.name,
                id: member.name,
                params: [],
                path
            };

            // If it's an interface, get its properties
            if (member.kind === apiExtractor.ApiItemKind.Interface) {
                for (const prop of member.members) {
                    if (prop.kind === apiExtractor.ApiItemKind.PropertySignature) {
                        typeDef.params?.push({
                            name: prop.name,
                            type: prop.propertyTypeExcerpt?.text || 'any',
                            description: utils.getDocComment(prop)
                        });
                    }
                }
            } else if (member.kind === apiExtractor.ApiItemKind.TypeAlias) {
                // For type aliases, check if they reference another type
                const typeExcerpt = member.typeExcerpt;
                if (typeExcerpt) {
                    // Look for references in the tokens
                    for (const token of typeExcerpt.tokens) {
                        if (token._kind === 'Reference' && token._canonicalReference) {
                            const referencedType = findTypeByCanonicalReference(apiPackage, token._canonicalReference);
                            if (referencedType && referencedType.kind === apiExtractor.ApiItemKind.Interface) {
                                for (const prop of referencedType.members) {
                                    if (prop.kind === apiExtractor.ApiItemKind.PropertySignature) {
                                        typeDef.params?.push({
                                            name: prop.name,
                                            type: prop.propertyTypeExcerpt?.text || 'any',
                                            description: utils.getDocComment(prop)
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            typeDefinitions.push(typeDef);
        }
    }
}

// Compose the output to match the GraphQL query structure
const output = {
    // Classes section (for this script, we only have one class: PostHog)
    id: 'posthog-js',
    "hogRef": "0.1",
    "info": {
        "id": "posthog-js",
        "title": "PostHog JavaScript Web SDK",
        "description": "Posthog-js allows you to automatically capture usage and send events to PostHog.",
        "slugPrefix": "posthog-js",
        "specUrl": "https://github.com/PostHog/posthog-js/blob/main/posthog-js-references.json"
    },
    classes: [
        {
            description: utils.getDocComment(posthogClass),
            id: posthogClass?.name || 'PostHog',
            title: posthogClass?.name || 'PostHog',
            functions: (methodInfo || []).map((func: any) => ({
                category: func.category || 'default',
                description: func.description,
                details: func.details,
                id: func.id,
                showDocs: true,
                title: func.title,
                examples: func.examples,
                params: (func.params || []).map((param: any) => ({
                    description: param.description || '',
                    isOptional: param.isOptional || false,
                    type: param.type || '',
                    name: param.name || ''
                })),
                returnType: func.returnType || { id: 'void', name: 'void' }
            }))
        }
    ],
    // Types section
    types: typeDefinitions.map((type: TypeDefinition) => ({
        id: type.id,
        name: type.name,
        properties: (type.params || []).map((param: any) => ({
            description: param.description,
            type: param.type,
            name: param.name,
            // include extra properties if any in the future
        })),
        // include extra properties if any
        ...(type.path ? { path: type.path } : {})
    }))
};

writeFileSync('docs/posthog-js-references.json', JSON.stringify(output, null, 2));
console.log('Method information written to docs/posthog-js-references.json');


