const path = require('path');
const { generateApiSpecs } = require('../../../scripts/docs/parser');
const { HOG_REF, PROPERTIES_EXAMPLE, PROPERTY_EXAMPLE } = require('../../../scripts/docs/constants');

const config = {
    packageDir: path.resolve(__dirname, '..'),  // packages/browser
    apiJsonPath: path.resolve(__dirname, '../docs/posthog-js.api.json'),
    outputPath: path.resolve(__dirname, '../docs/posthog-js-references.json'),
    id: 'posthog-js',
    hogRef: HOG_REF,
    specInfo: {
        id: 'posthog-js',
        title: 'PostHog JavaScript Web SDK',
        description: 'Posthog-js allows you to automatically capture usage and send events to PostHog.',
        slugPrefix: 'posthog-js',
        specUrl: 'https://github.com/PostHog/posthog-js'
    },
    typeExamples: {
        Properties: PROPERTIES_EXAMPLE,
        Property: PROPERTY_EXAMPLE
    },
    parentClass: 'PostHog'
};

generateApiSpecs(config);