import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['.svelte-kit/', 'build/']),
    js.configs.recommended,
    ts.configs.recommendedTypeChecked,
    svelte.configs.recommended,
    // Prettier owns formatting (spec §7); switch off rules that would fight it.
    prettier,
    svelte.configs.prettier,
    {
        languageOptions: {
            globals: { ...globals.browser },
            parserOptions: {
                // Type-aware linting, including inside <script> blocks in .svelte files.
                projectService: true,
                // Anchor project discovery to this directory rather than letting it be
                // inferred from the process cwd, so editors and CLI runs agree.
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.svelte'],
                parser: ts.parser
            }
        }
    },
    {
        // Config files run in Node, not the browser.
        files: ['*.config.{js,ts}'],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        // This file is the one source file outside SvelteKit's tsconfig, so the
        // project service has no type information for it: lint it syntactically only.
        // (Type-aware rules here would need @types/node purely for import.meta.)
        files: ['eslint.config.js'],
        extends: [ts.configs.disableTypeChecked]
    }
]);
