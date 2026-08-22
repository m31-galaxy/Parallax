import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    // Spike: expose the LLM/search keys from .env to the client bundle. The
    // app has no server (spec §7), so distillation calls OpenAI/Tavily
    // directly from the browser. Local development only — never ship a build
    // with these set.
    envPrefix: ['VITE_', 'OPENAI_', 'TAVILY_'],
    // Honor an externally assigned port (e.g. the preview harness's PORT).
    server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
    plugins: [
        sveltekit({
            compilerOptions: {
                // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
                runes: ({ filename }) =>
                    filename.split(/[/\\]/).includes('node_modules') ? undefined : true
            },
            // SPA mode: no prerendering, all routes served by the client (spec §7)
            adapter: adapter({ fallback: 'index.html' })
        })
    ]
});
