<script lang="ts">
    import type { Snippet } from 'svelte';
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import { classStore } from '$lib/db/classes.svelte';

    let { children }: { children: Snippet } = $props();

    const className = $derived(page.params.name ?? '');
    const summary = $derived(classStore.all.find((c) => c.name === className));
    const objectsHref = $derived(resolve('/classes/[name]', { name: className }));
    const schemaHref = $derived(resolve('/classes/[name]/schema', { name: className }));
</script>

<div class="class-page">
    <header>
        <h1>{summary?.plural ?? className}</h1>
        <nav aria-label="Class views">
            <a href={objectsHref} aria-current={page.url.pathname !== schemaHref}>Objects</a>
            <a href={schemaHref} aria-current={page.url.pathname === schemaHref}>Schema</a>
        </nav>
    </header>
    {@render children()}
</div>

<style>
    .class-page {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    header {
        display: flex;
        align-items: baseline;
        gap: 1.25rem;
        border-bottom: 1px solid #ddd;
        padding-bottom: 0.5rem;
    }

    h1 {
        margin: 0;
        font-size: 1.4rem;
    }

    nav {
        display: flex;
        gap: 0.75rem;
    }

    nav a {
        color: #555;
        text-decoration: none;
        padding: 0.15rem 0;
        border-bottom: 2px solid transparent;
    }

    nav a[aria-current='true'] {
        color: inherit;
        font-weight: 600;
        border-bottom-color: #555;
    }
</style>
