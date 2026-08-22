<script lang="ts">
    import { SvelteSet } from 'svelte/reactivity';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import {
        classStore,
        createClass,
        FIELD_TYPE_LABELS,
        FIELD_TYPES,
        isValidClassName,
        isValidFieldName,
        type NewField
    } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';

    interface FieldDraft extends NewField {
        key: number;
    }

    let nextKey = 0;
    function blankField(): FieldDraft {
        return { key: nextKey++, name: '', type: 'text', required: false };
    }

    let name = $state('');
    let plural = $state('');
    let fields = $state<FieldDraft[]>([blankField()]);
    let busy = $state(false);
    let serverError = $state<string | null>(null);

    const validationErrors = $derived.by(() => {
        const errors: string[] = [];
        if (name !== '' && !isValidClassName(name))
            errors.push(`Class name must be PascalCase (e.g. "Person"), got "${name}".`);
        const named = fields.filter((f) => f.name !== '');
        for (const field of named) {
            if (!isValidFieldName(field.name))
                errors.push(
                    `Field name must be snake_case and not "id" (e.g. "first_name"), got "${field.name}".`
                );
        }
        const seen = new SvelteSet<string>();
        for (const field of named) {
            if (seen.has(field.name)) errors.push(`Duplicate field name "${field.name}".`);
            seen.add(field.name);
        }
        return errors;
    });

    const submittable = $derived(
        name !== '' && plural.trim() !== '' && validationErrors.length === 0 && !busy
    );

    async function submit(): Promise<void> {
        busy = true;
        serverError = null;
        try {
            const cleaned = fields.filter((f) => f.name !== '');
            await createClass(connection.client, name, plural.trim(), cleaned);
            await classStore.refresh();
            await goto(resolve('/classes/[name]', { name }));
        } catch (err) {
            serverError = err instanceof Error ? err.message : String(err);
        } finally {
            busy = false;
        }
    }
</script>

<main>
    <h1>New class</h1>

    <form
        onsubmit={(event) => {
            event.preventDefault();
            void submit();
        }}
    >
        <div class="names">
            <label>
                Singular name (class &amp; table name)
                <input bind:value={name} required placeholder="Person" />
            </label>
            <label>
                Plural name (shown in the sidebar)
                <input bind:value={plural} required placeholder="People" />
            </label>
        </div>

        <fieldset>
            <legend>Fields</legend>
            {#each fields as field (field.key)}
                <div class="field-row">
                    <input
                        bind:value={field.name}
                        placeholder="field_name"
                        aria-label="Field name"
                    />
                    <select bind:value={field.type} aria-label="Field type">
                        {#each FIELD_TYPES as type (type)}
                            <option value={type}>{FIELD_TYPE_LABELS[type]}</option>
                        {/each}
                    </select>
                    <label class="required">
                        <input type="checkbox" bind:checked={field.required} />
                        required
                    </label>
                    <button
                        type="button"
                        aria-label="Remove field"
                        onclick={() => (fields = fields.filter((f) => f.key !== field.key))}
                    >
                        ✕
                    </button>
                </div>
            {/each}
            <button type="button" onclick={() => fields.push(blankField())}>+ Add field</button>
        </fieldset>

        {#each validationErrors as error (error)}
            <p class="error">{error}</p>
        {/each}
        {#if serverError !== null}
            <p class="error">{serverError}</p>
        {/if}

        <button type="submit" disabled={!submittable}>Create class</button>
    </form>
</main>

<style>
    main {
        max-width: 40rem;
        padding: 2rem 1.5rem;
    }

    h1 {
        font-size: 1.4rem;
    }

    form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .names {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .names label {
        flex: 1;
        min-width: 14rem;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }

    fieldset {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        background: #fff;
    }

    legend {
        font-size: 0.9rem;
        color: #555;
        padding: 0 0.25rem;
    }

    .field-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }

    .field-row input:not([type='checkbox']) {
        flex: 1;
    }

    label.required {
        flex-direction: row;
        align-items: center;
        gap: 0.3rem;
        white-space: nowrap;
    }

    input,
    select {
        font: inherit;
        padding: 0.4rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    button {
        font: inherit;
        padding: 0.4rem 0.8rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        align-self: flex-start;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
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
