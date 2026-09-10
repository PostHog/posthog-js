// Keep the ES6 syntax ceiling as well as the existing minimum browser versions.
// Oxc cannot lower ES2015 to ES5; the IE11 artifact must still use Babel.
export const modernTransformOptions = {
    target: ['es2015', 'chrome63', 'firefox60', 'ios10.3', 'opera51', 'safari12.1'],
    assumptions: { setPublicClassFields: true },
}
