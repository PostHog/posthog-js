const path = require('path');
const { generateApiSpecs } = require('../../../scripts/docs/parser');
const { HOG_REF } = require('../../../scripts/docs/constants');

// Node-specific configuration
const NODE_SPEC_INFO = {
    id: 'posthog-node',
    title: 'PostHog Node.js SDK',
    description: 'PostHog Node.js SDK allows you to capture events and send them to PostHog from your Node.js applications.',
    slugPrefix: 'posthog-node',
    specUrl: 'https://github.com/PostHog/posthog-js'
};

// Node-specific type examples (can be customized as needed)
const NODE_TYPE_EXAMPLES = {
    Properties: `// Properties for Node.js events
{
    event: 'user_signed_up',
    userId: 'user123',
    timestamp: new Date().toISOString(),
    distinct_id: 'user123',
    $set: {
        email: 'user@example.com',
        name: 'John Doe'
    }
}`,
    Property: `// Node.js property value
"user@example.com" | { name: "John", age: 25 }`
};

const config = {
    packageDir: path.resolve(__dirname, '..'),  // packages/node
    apiJsonPath: path.resolve(__dirname, '../docs/posthog-node.api.json'),
    outputPath: path.resolve(__dirname, '../docs/posthog-node-references.json'),
    id: NODE_SPEC_INFO.id,
    hogRef: HOG_REF,
    specInfo: NODE_SPEC_INFO,
    typeExamples: NODE_TYPE_EXAMPLES
};

generateApiSpecs(config);