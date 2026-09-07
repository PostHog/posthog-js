#!/usr/bin/env bash
set -euo pipefail
# Generate an isolated test app from the repository's maintained RN Android template.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=${1:?Usage: prepare-app.sh APP_DIRECTORY TARBALL_DIRECTORY}
TARBALLS=${2:?Tarball directory containing core.tgz, types.tgz, react-native.tgz}
mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)
TARBALLS=$(cd "$TARBALLS" && pwd)
test ! -e "$DEST/android" || { echo "APP_DIRECTORY must be fresh" >&2; exit 1; }
cp -R "$ROOT/examples/example-rn-native-plugin/android" "$DEST/android"
cp "$ROOT/examples/example-rn-native-plugin/babel.config.js" "$DEST/"
cp "$ROOT/compliance/react-native/app.js" "$DEST/index.js"
cat > "$DEST/metro.config.js" <<'EOF'
const { getDefaultConfig } = require('@react-native/metro-config')
module.exports = getDefaultConfig(__dirname)
EOF
printf "export const controllerURL = 'http://127.0.0.1:%s'\n" "${PORT:-18213}" > "$DEST/controller-config.js"
node - "$DEST" "$TARBALLS" <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const [dest, tarballs] = process.argv.slice(2)
const dependencies = {
    'react': '19.0.0', 'react-native': '0.79.6',
    'posthog-react-native': `file:${tarballs}/react-native.tgz`,
    '@react-native-async-storage/async-storage': '2.1.2',
    'react-native-device-info': '10.14.0',
}
const devDependencies = {
    '@babel/core': '7.25.2', '@babel/runtime': '7.25.0',
    '@react-native-community/cli': '18.0.1',
    '@react-native-community/cli-platform-android': '18.0.1',
    '@react-native/babel-preset': '0.79.6', '@react-native/metro-config': '0.79.6',
}
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({
    name: 'posthog-rn-compliance-app', version: '1.0.0', private: true, dependencies, devDependencies,
    overrides: { '@posthog/core': `file:${tarballs}/core.tgz`, '@posthog/types': `file:${tarballs}/types.tgz` },
}, null, 2))
function replace(dir) {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, file.name)
        if (file.isDirectory()) replace(full)
        else if (/\.(kt|gradle|xml)$/.test(file.name)) {
            fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replaceAll('posthogreactnativeplugin.example', 'com.posthog.compliance.rn'))
        }
    }
}
replace(path.join(dest, 'android'))
// A bundled debug APK needs no Metro server or external development port.
const gradle = path.join(dest, 'android/app/build.gradle')
fs.writeFileSync(gradle, fs.readFileSync(gradle, 'utf8').replace('react {', 'react {\n    debuggableVariants = []'))
const app = path.join(dest, 'android/app/src/main/java/posthogreactnativeplugin/example/MainApplication.kt')
fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace('getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG', 'getUseDeveloperSupport(): Boolean = false'))
JS
cd "$DEST"
npm install --legacy-peer-deps --no-audit --no-fund
node - <<'JS'
const fs = require('node:fs')
const sdk = JSON.parse(fs.readFileSync('node_modules/posthog-react-native/package.json', 'utf8'))
fs.appendFileSync('controller-config.js', `export const sdkVersion = ${JSON.stringify(sdk.version)}\n`)
JS
cd android
./gradlew :app:assembleDebug --no-daemon --console=plain -PreactNativeArchitectures="${RN_ARCH:-arm64-v8a}"
