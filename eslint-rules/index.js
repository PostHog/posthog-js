const { readdirSync } = require('fs')
const { basename } = require('path')

const projectName = 'posthog-js'
const ruleFiles = readdirSync('eslint-rules').filter(
    (file) => file.endsWith('.js') && file !== 'index.js' && !file.endsWith('test.js')
)
const configs = {
    all: {
        plugins: [projectName],
        rules: Object.fromEntries(ruleFiles.map((file) => [`${projectName}/${basename(file, '.js')}`, 'error'])),
    },
}

const rules = Object.fromEntries(ruleFiles.map((file) => [basename(file, '.js'), require('./' + file)]))

module.exports = { configs, rules }
