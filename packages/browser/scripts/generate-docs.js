const path = require('path');
const { generateApiSpecs } = require('../../../scripts/docs/parser');
const { HOG_REF, SPEC_INFO, PROPERTIES_EXAMPLE, PROPERTY_EXAMPLE } = require('../../../scripts/docs/constants');

const config = {
    packageDir: path.resolve(__dirname, '..'),  // packages/browser
    apiJsonPath: path.resolve(__dirname, '../docs/posthog-js.api.json'),
    outputPath: path.resolve(__dirname, '../docs/posthog-js-references.json'),
    id: SPEC_INFO.id,
    hogRef: HOG_REF,
    specInfo: SPEC_INFO,
    typeExamples: {
        Properties: PROPERTIES_EXAMPLE,
        Property: PROPERTY_EXAMPLE
    }
};

generateApiSpecs(config);