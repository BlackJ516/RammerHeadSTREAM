const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    { ignores: ['transports/**', 'node_modules/**', 'engines/*/node_modules/**', 'engines/*/client/**', 'engines/*/wasm/target/**', 'engines/_backups/**', 'cache-js/**', 'data/**', 'sessions/**', 'bench/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { 'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }] }
    },
    {
        // the interface runs in the browser as a plain script
        files: ['public/**/*.js'],
        languageOptions: { sourceType: 'script', globals: { ...globals.browser } }
    }
];
