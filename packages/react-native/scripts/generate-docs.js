const path = require('path');
const { generateApiSpecs } = require('../../../scripts/docs/parser');
const { HOG_REF } = require('../../../scripts/docs/constants');

// Node-specific configuration
const REACT_NATIVE_SPEC_INFO = {
    id: 'posthog-react-native',
    title: 'PostHog React Native SDK',
    description: 'PostHog React Native SDK allows you to capture events and send them to PostHog from your React Native applications.',
    slugPrefix: 'posthog-react-native',
    specUrl: 'https://github.com/PostHog/posthog-js'
};

// Node-specific type examples (can be customized as needed)
const REACT_NATIVE_TYPE_EXAMPLES = {
    Properties: `// Properties for React Native events
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
    Property: `// React Native property value
"user@example.com" | { name: "John", age: 25 }`
};

const config = {
    packageDir: path.resolve(__dirname, '..'),  // packages/react-native
    apiJsonPath: path.resolve(__dirname, '../docs/posthog-react-native.api.json'),
    outputPath: path.resolve(__dirname, '../docs/posthog-react-native-references.json'),
    id: REACT_NATIVE_SPEC_INFO.id,
    hogRef: HOG_REF,
    specInfo: REACT_NATIVE_SPEC_INFO,
    typeExamples: REACT_NATIVE_TYPE_EXAMPLES,
    parentClass: 'PostHog',
    extraMethods: ['PostHogProvider']
};

generateApiSpecs(config);