<script lang="ts">
    import ValueEditor from './ValueEditor.svelte';
    import type { FieldType } from '$lib/db/classes.svelte';
    import { blankDraft, type DraftValue } from '$lib/db/objects';

    export interface RefOption {
        value: string;
        label: string;
    }

    interface Props {
        type: FieldType;
        draft: DraftValue;
        /** Top-level field requiredness; governs widget attributes only. */
        required?: boolean;
        /** List elements always hold a value once kept; affects widgets. */
        isElement?: boolean;
        optionsByTarget: Record<string, RefOption[]>;
    }

    let {
        type,
        draft = $bindable(),
        required = false,
        isElement = false,
        optionsByTarget
    }: Props = $props();

    function addItem(): void {
        if (type.kind === 'list' && Array.isArray(draft)) {
            draft.push(blankDraft(type.element, true));
        }
    }

    function removeItem(index: number): void {
        if (Array.isArray(draft)) draft.splice(index, 1);
    }
</script>

{#if type.kind === 'list'}
    <div class="list-editor">
        {#if Array.isArray(draft)}
            {#each draft.keys() as index (index)}
                <div class="list-item">
                    <ValueEditor
                        type={type.element}
                        bind:draft={draft[index]}
                        isElement={true}
                        {optionsByTarget}
                    />
                    <button
                        type="button"
                        aria-label="Remove item"
                        onclick={() => removeItem(index)}
                    >
                        ✕
                    </button>
                </div>
            {/each}
        {/if}
        <button type="button" class="add-item" onclick={addItem}>+ Add item</button>
    </div>
{:else if type.kind === 'boolean'}
    {#if required || isElement}
        <input type="checkbox" bind:checked={draft as boolean} />
    {:else}
        <select bind:value={draft}>
            <option value="">—</option>
            <option value="true">yes</option>
            <option value="false">no</option>
        </select>
    {/if}
{:else if type.kind === 'reference'}
    {@const options = optionsByTarget[type.target] ?? []}
    <select bind:value={draft} required={required && !isElement}>
        {#if required && !isElement}
            <option value="" disabled>Select a {type.target}…</option>
        {:else}
            <option value="">—</option>
        {/if}
        {#if typeof draft === 'string' && draft !== '' && !options.some((o) => o.value === draft)}
            <option value={draft}>{draft} (missing)</option>
        {/if}
        {#each options as option (option.value)}
            <option value={option.value}>{option.label}</option>
        {/each}
    </select>
{:else if type.kind === 'long_text'}
    <textarea bind:value={draft as string} rows="5" required={required && !isElement}></textarea>
{:else if type.kind === 'number'}
    <input
        type="number"
        step="any"
        bind:value={draft as string}
        required={required && !isElement}
    />
{:else if type.kind === 'datetime'}
    <input type="datetime-local" bind:value={draft as string} required={required && !isElement} />
{:else}
    <input bind:value={draft as string} required={required && !isElement} />
{/if}

<style>
    input:not([type='checkbox']),
    select,
    textarea {
        font: inherit;
        padding: 0.4rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        width: 100%;
        box-sizing: border-box;
    }

    textarea {
        resize: vertical;
    }

    .list-editor {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        border-left: 2px solid #e5e5e5;
        padding-left: 0.6rem;
    }

    .list-item {
        display: flex;
        gap: 0.4rem;
        align-items: flex-start;
    }

    .list-item > :global(*:first-child) {
        flex: 1;
    }

    button {
        font: inherit;
        font-size: 0.85rem;
        padding: 0.25rem 0.55rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        align-self: flex-start;
    }
</style>
