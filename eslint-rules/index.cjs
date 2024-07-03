const { readdirSync } = require('fs')
const { basename } = require('path')

const projectName = 'posthog-js'
const ruleFiles = readdirSync('eslint-rules').filter(
    (file) => file.endsWith('.cjs') && file !== 'index.cjs' && !file.endsWith('test.cjs')
)
const configs = {
    all: {
        plugins: [projectName],
        rules: Object.fromEntries(ruleFiles.map((file) => [`${projectName}/${basename(file, '.cjs')}`, 'error'])),
    },
}

const rules = Object.fromEntries(ruleFiles.map((file) => [basename(file, '.cjs'), require('./' + file)]))

module.exports = { configs, rules }
