<script lang="ts">
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import ObjectForm from '$lib/components/ObjectForm.svelte';
    import { getClass, type ClassView } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { getObject, updateObject, type ObjectRecord } from '$lib/db/objects';

    let cls = $state<ClassView | null>(null);
    let record = $state<ObjectRecord | null>(null);
    let loadError = $state<string | null>(null);
    let submitError = $state<string | null>(null);
    let busy = $state(false);

    const className = $derived(page.params.name ?? '');
    const objectIdParam = $derived(page.params.id ?? '');

    $effect(() => {
        void load(className, objectIdParam);
    });

    async function load(name: string, id: string): Promise<void> {
        cls = null;
        record = null;
        loadError = null;
        try {
            cls = await getClass(connection.client, name);
            const found = await getObject(connection.client, name, id);
            if (found === undefined) throw new Error(`No ${name} with id "${id}" exists`);
            record = found;
        } catch (err) {
            loadError = err instanceof Error ? err.message : String(err);
        }
    }

    async function submit(data: Record<string, unknown>): Promise<void> {
        busy = true;
        submitError = null;
        try {
            await updateObject(connection.client, className, objectIdParam, data);
            await goto(resolve('/classes/[name]', { name: className }));
        } catch (err) {
            submitError = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
        }
    }
</script>

<main>
    {#if loadError !== null}
        <p class="error">{loadError}</p>
    {:else if cls === null || record === null}
        <p class="muted">Loading…</p>
    {:else}
        <h2>Edit <code>{String(record.id)}</code></h2>
        <ObjectForm
            fields={cls.fields}
            initial={record}
            submitLabel="Save"
            {busy}
            error={submitError}
            onsubmit={(data: Record<string, unknown>) => void submit(data)}
        />
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
