<script lang="ts">
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import ObjectForm from '$lib/components/ObjectForm.svelte';
    import { getClass, type ClassView } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { DelayedLoading } from '$lib/loading.svelte';
    import { createObject } from '$lib/db/objects';

    let cls = $state<ClassView | null>(null);
    let loadError = $state<string | null>(null);
    let submitError = $state<string | null>(null);
    let busy = $state(false);
    const loading = new DelayedLoading();
    let requestToken = 0;

    const className = $derived(page.params.name ?? '');

    $effect(() => {
        void load(className);
    });

    // Stale-while-loading: previous content stays visible unless the load
    // outlives the grace window; the token discards out-of-order responses.
    async function load(name: string): Promise<void> {
        const token = ++requestToken;
        loading.start();
        loadError = null;
        try {
            const view = await getClass(connection.client, name);
            if (token !== requestToken) return;
            cls = view;
        } catch (err) {
            if (token !== requestToken) return;
            loadError = err instanceof Error ? err.message : String(err);
            cls = null;
        } finally {
            if (token === requestToken) loading.finish();
        }
    }

    async function submit(data: Record<string, unknown>): Promise<void> {
        busy = true;
        submitError = null;
        try {
            await createObject(connection.client, className, data);
            await goto(resolve('/classes/[name]', { name: className }));
        } catch (err) {
            submitError = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
        }
    }
</script>

<main>
    <h2>New {className}</h2>
    {#if loadError !== null}
        <p class="error">{loadError}</p>
    {:else if loading.pending || cls === null}
        <p class="muted">Loading…</p>
    {:else}
        {#key cls}
            <ObjectForm
                fields={cls.fields}
                submitLabel="Create"
                {busy}
                error={submitError}
                onsubmit={(data: Record<string, unknown>) => void submit(data)}
            />
        {/key}
    {/if}
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    h2 {
        margin: 0;
        font-size: 1rem;
    }

    .muted {
        color: #666;
    }

    .error {
        margin: 0;
        color: #b3261e;
        background: #fdeceb;
        border: 1px solid #f3c0bc;
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
        overflow-wrap: anywhere;
    }
</style>
