const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Extractor, ExtractorConfig } = require('@microsoft/api-extractor');
const { ApiPackage } = require('@microsoft/api-extractor-model');
const { resolveTypeDefinitions } = require('../types');
const { createTypeResolver } = require('../type-resolver');

const fixtureDir = path.join(__dirname, 'fixtures', 'reference-types');
const entryPath = path.join(fixtureDir, 'index.d.ts');

function buildApiPackage() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-reference-types-'));
    const apiJsonPath = path.join(tmpDir, 'reference-types-fixture.api.json');

    const extractorConfig = ExtractorConfig.prepare({
        configObject: {
            projectFolder: fixtureDir,
            mainEntryPointFilePath: entryPath,
            compiler: {
                overrideTsconfig: { compilerOptions: { skipLibCheck: true, types: [] } },
            },
            docModel: { enabled: true, apiJsonFilePath: apiJsonPath },
            apiReport: { enabled: false },
            dtsRollup: { enabled: false },
            tsdocMetadata: { enabled: false },
        },
        configObjectFullPath: undefined,
        packageJsonFullPath: path.join(fixtureDir, 'package.json'),
    });

    const result = Extractor.invoke(extractorConfig, {
        localBuild: true,
        messageCallback: (message) => {
            message.handled = true;
        },
    });
    assert.ok(result.succeeded, 'api-extractor run on the fixture failed');

    return ApiPackage.loadFromJsonFile(apiJsonPath);
}

const apiPackage = buildApiPackage();
const typeResolver = createTypeResolver(entryPath);

const byName = (types, name) => {
    const found = types.find((t) => t.name === name);
    assert.ok(found, `type ${name} missing from resolved definitions`);
    return found;
};

const propByName = (type, name) => {
    const found = type.properties.find((p) => p.name === name);
    assert.ok(found, `property ${name} missing from ${type.name}`);
    return found;
};

describe('createTypeResolver classification', () => {
    test('classifies object-shaped aliases, including Omit intersections', () => {
        assert.equal(typeResolver.resolveTypeAlias('Config').kind, 'object');
        assert.equal(typeResolver.resolveTypeAlias('FlagVariant').kind, 'object');
    });

    test('classifies function aliases', () => {
        assert.equal(typeResolver.resolveTypeAlias('LoadedCallback').kind, 'function');
    });

    test('callable types with members keep their full signature', () => {
        assert.equal(typeResolver.resolveTypeAlias('CallableWithProps').kind, 'signature');
    });

    test('classifies unions', () => {
        assert.equal(typeResolver.resolveTypeAlias('Fruit').kind, 'union');
        assert.equal(typeResolver.resolveTypeAlias('Question').kind, 'union');
    });

    test('classifies index-signature-only aliases and tuples as raw signatures', () => {
        assert.equal(typeResolver.resolveTypeAlias('PropertyFilters').kind, 'signature');
        assert.equal(typeResolver.resolveTypeAlias('Pair').kind, 'signature');
    });

    test('unions collapsed to a primitive are not objects', () => {
        assert.equal(typeResolver.resolveTypeAlias('LooseId').kind, 'other');
    });

    test('returns null when the same alias name is declared differently in several files', () => {
        assert.equal(typeResolver.resolveTypeAlias('Dup'), null);
    });

    test('resolves aliases declared outside the entry point', () => {
        assert.equal(typeResolver.resolveTypeAlias('RemoteMode').kind, 'object');
    });

    test('resolves aliases referenced by the public API but not exported', () => {
        const hidden = typeResolver.resolveTypeAlias('HiddenOptions');
        assert.equal(hidden.kind, 'object');
        assert.deepEqual(hidden.properties, [
            { name: 'verbose', type: 'boolean', description: 'Enables verbose output' },
        ]);
    });

    test('returns null for interfaces, generic aliases and unknown names', () => {
        assert.equal(typeResolver.resolveTypeAlias('BaseConfig'), null);
        assert.equal(typeResolver.resolveTypeAlias('WithoutKind'), null);
        assert.equal(typeResolver.resolveTypeAlias('DoesNotExist'), null);
    });
});

describe('resolveTypeDefinitions with type resolver', () => {
    const types = resolveTypeDefinitions(apiPackage, typeResolver);

    test('flattens Omit + intersection aliases to their effective members', () => {
        const config = byName(types, 'Config');
        const names = config.properties.map((p) => p.name).sort();
        assert.deepEqual(names, ['api_host', 'debug', 'loaded', 'old_host', 'token']);
        assert.equal(config.example, undefined);

        assert.equal(propByName(config, 'api_host').type, 'string');
        assert.equal(propByName(config, 'api_host').description, 'URL of the API host');
        assert.equal(propByName(config, 'token').description, 'Optional project token');
        assert.match(propByName(config, 'loaded').type, /=>/);
        assert.equal(propByName(config, 'loaded').description, 'Called with the initialized client');
    });

    test('extracts properties of plain object literal aliases', () => {
        const flagVariant = byName(types, 'FlagVariant');
        assert.deepEqual(
            flagVariant.properties.map(({ name, type }) => ({ name, type })),
            [
                { name: 'flag', type: 'string' },
                { name: 'variant', type: 'string' },
            ]
        );
    });

    test('keeps callback aliases as signature examples', () => {
        const callback = byName(types, 'LoadedCallback');
        assert.deepEqual(callback.properties, []);
        assert.match(callback.example, /=>/);
    });

    test('keeps string literal unions as examples', () => {
        const fruit = byName(types, 'Fruit');
        assert.deepEqual(fruit.properties, []);
        assert.equal(fruit.example, '"apple" | "banana" | "cherry"');
    });

    test('keeps index-signature aliases as signature examples without garbage properties', () => {
        const filters = byName(types, 'PropertyFilters');
        assert.deepEqual(filters.properties, []);
        assert.match(filters.example, /^\{/);
    });

    test('callable-with-members aliases publish the call signature via example', () => {
        const callable = byName(types, 'CallableWithProps');
        assert.deepEqual(callable.properties, []);
        assert.match(callable.example, /\(input: string\): boolean/);
        assert.match(callable.example, /label: string/);
    });

    test('keeps unions of interfaces as union examples', () => {
        const question = byName(types, 'Question');
        assert.deepEqual(question.properties, []);
        assert.equal(question.example, 'QuestionA | QuestionB');
    });

    test('tuples keep their signature as example, without numeric index properties', () => {
        const pair = byName(types, 'Pair');
        assert.deepEqual(pair.properties, []);
        assert.equal(pair.example, '[name: string, value: number]');
    });

    test('unions collapsed to string still surface their known literals', () => {
        const looseId = byName(types, 'LooseId');
        assert.deepEqual(looseId.properties, []);
        assert.equal(looseId.example, '"special"');
    });

    test('generic aliases fall back to their signature, not quoted type arguments', () => {
        const withoutKind = byName(types, 'WithoutKind');
        assert.deepEqual(withoutKind.properties, []);
        assert.equal(withoutKind.example, "Omit<T, 'kind'>");
    });

    test('interfaces keep their members', () => {
        const base = byName(types, 'BaseConfig');
        assert.deepEqual(base.properties.map((p) => p.name), ['api_host', 'loaded', 'old_host', 'token']);
    });

    test('underscore-prefixed members are excluded from both paths', () => {
        const published = (type) => type.properties.map((p) => p.name);
        assert.ok(!published(byName(types, 'BaseConfig')).includes('__internal_flag'));
        assert.ok(!published(byName(types, 'Config')).includes('__internal_flag'));
    });

    test('deprecated members are tagged and carry their migration text in both paths', () => {
        const oldHostVia = (name) => byName(types, name).properties.find((p) => p.name === 'old_host');
        for (const typeName of ['BaseConfig', 'Config']) {
            const prop = oldHostVia(typeName);
            assert.equal(prop.releaseTag, 'deprecated', `${typeName}.old_host releaseTag`);
            assert.match(prop.description, /Deprecated: Use api_host/);
        }
        const apiHost = byName(types, 'Config').properties.find((p) => p.name === 'api_host');
        assert.equal(apiHost.releaseTag, undefined);
    });

    test('deprecation text is appended to an existing summary in both paths', () => {
        for (const typeName of ['DeprecationShapes', 'DeprecationShapesAlias']) {
            const prop = byName(types, typeName).properties.find((p) => p.name === 'legacy_timeout');
            assert.equal(prop.releaseTag, 'deprecated', `${typeName}.legacy_timeout releaseTag`);
            assert.match(prop.description, /^Legacy timeout in ms\./, `${typeName} keeps the summary`);
            assert.match(prop.description, /Deprecated: Use current instead$/, `${typeName} appends the tag text`);
        }
    });

    test('bare @deprecated without a message still tags, with no fabricated description', () => {
        for (const typeName of ['DeprecationShapes', 'DeprecationShapesAlias']) {
            const prop = byName(types, typeName).properties.find((p) => p.name === 'retired');
            assert.equal(prop.releaseTag, 'deprecated', `${typeName}.retired releaseTag`);
            assert.equal(prop.description, undefined, `${typeName}.retired description`);
        }
    });

    test('deprecated underscore members win over the underscore exclusion in both paths', () => {
        for (const typeName of ['DeprecationShapes', 'DeprecationShapesAlias']) {
            const prop = byName(types, typeName).properties.find((p) => p.name === '__legacy_flag');
            assert.ok(prop, `${typeName}.__legacy_flag should be published`);
            assert.equal(prop.releaseTag, 'deprecated');
            assert.match(prop.description, /Deprecated: Use current instead/);
        }
    });

    test('descriptions ending in markdown emphasis keep their closing markers', () => {
        for (const typeName of ['DeprecationShapes', 'DeprecationShapesAlias']) {
            const prop = byName(types, typeName).properties.find((p) => p.name === 'emphasized');
            assert.equal(prop.description, 'This is **important**', `${typeName}.emphasized`);
        }
    });

    test('malformed JSDoc closers do not leak asterisks into descriptions', () => {
        for (const typeName of ['DeprecationShapes', 'DeprecationShapesAlias']) {
            const prop = byName(types, typeName).properties.find((p) => p.name === 'legacy_typo');
            assert.equal(prop.description, 'Deprecated: Gone. Use current', `${typeName}.legacy_typo`);
        }
        for (const t of types) {
            for (const p of t.properties || []) {
                assert.ok(!/\s\*+$/.test(p.description || ''), `${t.name}.${p.name} has a dangling asterisk`);
            }
        }
    });

    test('deprecated enum members are tagged', () => {
        const mode = byName(types, 'Mode');
        const legacy = mode.properties.find((p) => p.name === 'Legacy');
        const standard = mode.properties.find((p) => p.name === 'Standard');
        assert.equal(legacy.releaseTag, 'deprecated');
        assert.match(legacy.description, /Deprecated: Use Standard/);
        assert.equal(standard.releaseTag, undefined);
        assert.equal(standard.description, 'Standard mode');
    });

    test('serialized output carries releaseTag only on deprecated members', () => {
        const serialized = JSON.parse(JSON.stringify(types));
        const tagged = [];
        for (const t of serialized) {
            for (const p of t.properties || []) {
                if ('releaseTag' in p) {
                    assert.equal(p.releaseTag, 'deprecated', `${t.name}.${p.name} has unexpected releaseTag`);
                    tagged.push(`${t.name}.${p.name}`);
                }
            }
        }
        assert.ok(tagged.includes('Config.old_host'));
        const current = serialized.find((t) => t.name === 'DeprecationShapes').properties.find((p) => p.name === 'current');
        assert.ok(!('releaseTag' in current), 'non-deprecated properties must not serialize a releaseTag key');
    });

    test('cross-file property types render bare names, never import("...") qualifiers', () => {
        const remote = byName(types, 'Remote');
        assert.deepEqual(
            remote.properties.map(({ name, type }) => ({ name, type })),
            [
                { name: 'options', type: 'RemoteOptions' },
                { name: 'local', type: 'string' },
                { name: 'extra', type: 'ThirdBase' },
            ]
        );
        assert.doesNotMatch(JSON.stringify(types), /import\("/);
    });
});

describe('resolveTypeDefinitions without type resolver (fallback)', () => {
    const types = resolveTypeDefinitions(apiPackage, null);

    test('object literal aliases are not misclassified as callbacks', () => {
        const flagVariant = byName(types, 'FlagVariant');
        assert.deepEqual(flagVariant.properties.map((p) => p.name), ['flag', 'variant']);
    });

    test('Omit intersections degrade to a signature example, not a bogus literal union', () => {
        const config = byName(types, 'Config');
        assert.deepEqual(config.properties, []);
        assert.match(config.example, /^Omit<BaseConfig/);
    });

    test('callback aliases are still detected via top-level arrow', () => {
        const callback = byName(types, 'LoadedCallback');
        assert.deepEqual(callback.properties, []);
        assert.match(callback.example, /=>/);
    });

    test('string literal unions still produce examples', () => {
        const fruit = byName(types, 'Fruit');
        assert.equal(fruit.example, '"apple" | "banana" | "cherry"');
    });
});
