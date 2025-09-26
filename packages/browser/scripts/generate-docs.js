const path = require('path');
const fs = require('fs');
const { generateApiSpecs } = require('../../../scripts/docs/parser');
const { HOG_REF, PROPERTIES_EXAMPLE, PROPERTY_EXAMPLE } = require('../../../scripts/docs/constants');

// Read package.json to get version
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const version = packageJson.version;

const config = {
    packageDir: path.resolve(__dirname, '..'),  // packages/browser
    apiJsonPath: path.resolve(__dirname, '../docs/posthog-js.api.json'),
    outputPath: path.resolve(__dirname, `../references/posthog-js-references-${version}.json`),
    version: version,
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

// Ensure references directory exists
const referencesDir = path.resolve(__dirname, '../references');
if (!fs.existsSync(referencesDir)) {
    fs.mkdirSync(referencesDir, { recursive: true });
}

// Generate versioned file
const output = generateApiSpecs(config);

// Write versioned file
const versionedPath = path.resolve(__dirname, `../references/posthog-js-references-${version}.json`);
fs.writeFileSync(versionedPath, JSON.stringify(output, null, 2));

// Copy to latest file
const latestPath = path.resolve(__dirname, '../references/posthog-js-references-latest.json');
fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));