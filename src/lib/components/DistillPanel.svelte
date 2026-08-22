<script lang="ts">
    /**
     * Distil one note (spec §6): request extraction, poll for the worker's
     * proposals, then review each — approve into its class, or reject. Approving
     * commits with the same type coercion the object forms use; a value that
     * cannot be coerced, or a missing required field, blocks that one proposal
     * with the reason shown, rather than being forced in or silently dropped.
     */
    import type { RecordId } from 'surrealdb';
    import { connection } from '$lib/db/connection.svelte';
    import { getClass, type ClassView } from '$lib/db/classes.svelte';
    import { formatValue } from '$lib/db/objects';
    import ObjectForm from '$lib/components/ObjectForm.svelte';
    import {
        approveProposal,
        coerceProposal,
        commitProposalWith,
        getRequest,
        listProposals,
        rejectProposal,
        requestDistill,
        type Proposal
    } from '$lib/db/distill';

    interface Props {
        note: RecordId;
    }
    let { note }: Props = $props();

    type Phase = 'idle' | 'requesting' | 'waiting' | 'reviewing' | 'error';
    let phase = $state<Phase>('idle');
    let error = $state<string | null>(null);
    let proposals = $state<Proposal[]>([]);
    let classes = $state<Record<string, ClassView>>({});
    let rowBusy = $state<string | null>(null);
    let rowError = $state<Record<string, string>>({});
    let editingId = $state<string | null>(null);

    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const POLL_MS = 1000;
    const POLL_LIMIT = 120; // ~2 min before giving up on a silent worker

    function toMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    async function start(): Promise<void> {
        phase = 'requesting';
        error = null;
        proposals = [];
        rowError = {};
        try {
            const requestId = await requestDistill(connection.client, note);
            phase = 'waiting';
            poll(requestId, 0);
        } catch (err) {
            error = toMessage(err);
            phase = 'error';
        }
    }

    function poll(requestId: RecordId, attempt: number): void {
        pollTimer = setTimeout(async () => {
            try {
                const request = await getRequest(connection.client, requestId);
                if (request?.status === 'done') {
                    await loadProposals();
                    return;
                }
                if (request?.status === 'error') {
                    error = request.error ?? 'Distillation failed in the worker.';
                    phase = 'error';
                    return;
                }
                if (attempt >= POLL_LIMIT) {
                    error =
                        'No response from the distillation worker. Is it running? ' +
                        '(python experiments/distill-harness/worker.py)';
                    phase = 'error';
                    return;
                }
                poll(requestId, attempt + 1);
            } catch (err) {
                error = toMessage(err);
                phase = 'error';
            }
        }, POLL_MS);
    }

    async function loadProposals(): Promise<void> {
        proposals = await listProposals(connection.client, note);
        const views: Record<string, ClassView> = {};
        for (const className of new Set(proposals.map((p) => p.class_name))) {
            try {
                views[className] = await getClass(connection.client, className);
            } catch {
                // Class deleted since extraction; its proposals show unresolved.
            }
        }
        classes = views;
        phase = 'reviewing';
    }

    async function approve(proposal: Proposal): Promise<void> {
        rowBusy = String(proposal.id);
        rowError = { ...rowError, [String(proposal.id)]: '' };
        try {
            await approveProposal(connection.client, proposal);
            proposals = proposals.filter((p) => p.id !== proposal.id);
        } catch (err) {
            rowError = { ...rowError, [String(proposal.id)]: toMessage(err) };
        } finally {
            rowBusy = null;
        }
    }

    async function reject(proposal: Proposal): Promise<void> {
        rowBusy = String(proposal.id);
        try {
            await rejectProposal(connection.client, proposal.id);
            proposals = proposals.filter((p) => p.id !== proposal.id);
        } catch (err) {
            rowError = { ...rowError, [String(proposal.id)]: toMessage(err) };
        } finally {
            rowBusy = null;
        }
    }

    /** Field-by-field preview: coerced value, or why it will not commit. */
    function review(proposal: Proposal) {
        const cls = classes[proposal.class_name];
        if (!cls) return null;
        return coerceProposal(proposal, cls);
    }

    /** Seed the edit form with the values that DID coerce; the rest start empty
     *  so the user can fill or fix them (extraction missed or garbled them). */
    function initialFor(proposal: Proposal): Record<string, unknown> {
        return review(proposal)?.values ?? {};
    }

    async function submitEdit(proposal: Proposal, data: Record<string, unknown>): Promise<void> {
        rowBusy = String(proposal.id);
        rowError = { ...rowError, [String(proposal.id)]: '' };
        try {
            await commitProposalWith(connection.client, proposal, data);
            proposals = proposals.filter((p) => p.id !== proposal.id);
            editingId = null;
        } catch (err) {
            rowError = { ...rowError, [String(proposal.id)]: toMessage(err) };
        } finally {
            rowBusy = null;
        }
    }

    $effect(() => {
        return () => {
            if (pollTimer) clearTimeout(pollTimer);
        };
    });
</script>

<div class="distill">
    {#if phase === 'idle'}
        <button class="trigger" onclick={() => void start()}>Distil</button>
    {:else if phase === 'requesting' || phase === 'waiting'}
        <p class="muted">Distilling… (worker must be running)</p>
    {:else if phase === 'error'}
        <p class="error">{error}</p>
        <button class="trigger" onclick={() => void start()}>Try again</button>
    {:else if phase === 'reviewing'}
        {#if proposals.length === 0}
            <p class="muted">No objects proposed — or all reviewed.</p>
            <button class="trigger" onclick={() => void start()}>Distil again</button>
        {:else}
            <p class="muted">{proposals.length} proposed — approve to add to your classes:</p>
            <ul class="proposals">
                {#each proposals as proposal (String(proposal.id))}
                    {@const r = review(proposal)}
                    {@const cls = classes[proposal.class_name]}
                    <li class="proposal">
                        <div class="head">
                            <strong>{proposal.class_name}</strong>
                            <span class="conf">{(proposal.confidence * 100).toFixed(0)}%</span>
                        </div>

                        {#if editingId === String(proposal.id) && cls}
                            {#key proposal.id}
                                <ObjectForm
                                    fields={cls.fields}
                                    initial={initialFor(proposal)}
                                    submitLabel="Add to {proposal.class_name}"
                                    busy={rowBusy !== null}
                                    error={rowError[String(proposal.id)] || null}
                                    onsubmit={(data: Record<string, unknown>) =>
                                        void submitEdit(proposal, data)}
                                />
                            {/key}
                            <div class="actions">
                                <button
                                    disabled={rowBusy !== null}
                                    onclick={() => (editingId = null)}
                                >
                                    Cancel
                                </button>
                            </div>
                        {:else}
                            <dl class="fields">
                                {#each Object.entries(proposal.payload) as [field, value] (field)}
                                    <dt>{field}</dt>
                                    <dd class:unparsed={r?.unparsed[field]}>
                                        {formatValue(value)}
                                        {#if r?.unparsed[field]}
                                            <span class="flag"
                                                >can’t use — {r.unparsed[field].reason}</span
                                            >
                                        {/if}
                                    </dd>
                                {/each}
                            </dl>
                            {#if r && r.missing.length > 0}
                                <p class="blocked">
                                    Missing required: {r.missing.join(', ')} — use Edit to fill it in.
                                </p>
                            {/if}
                            {#if rowError[String(proposal.id)]}
                                <p class="error small">{rowError[String(proposal.id)]}</p>
                            {/if}
                            <div class="actions">
                                <button
                                    disabled={rowBusy !== null || (r?.missing.length ?? 0) > 0}
                                    onclick={() => void approve(proposal)}
                                >
                                    Approve
                                </button>
                                <button
                                    disabled={rowBusy !== null || !cls}
                                    onclick={() => (editingId = String(proposal.id))}
                                >
                                    Edit
                                </button>
                                <button
                                    class="danger"
                                    disabled={rowBusy !== null}
                                    onclick={() => void reject(proposal)}
                                >
                                    Reject
                                </button>
                            </div>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    {/if}
</div>

<style>
    .distill {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .trigger {
        font: inherit;
        font-size: 0.85rem;
        padding: 0.2rem 0.55rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        align-self: flex-start;
    }

    .trigger:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .muted {
        margin: 0;
        color: #666;
        font-size: 0.8rem;
    }

    .proposals {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .proposal {
        border: 1px solid #e2e2e2;
        border-radius: 6px;
        padding: 0.5rem 0.6rem;
        background: #fafafa;
    }

    .head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 0.85rem;
    }

    .conf {
        color: #888;
        font-size: 0.75rem;
    }

    .fields {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.1rem 0.5rem;
        margin: 0.35rem 0;
        font-size: 0.8rem;
    }

    dt {
        color: #666;
        font-family: ui-monospace, monospace;
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }

    dd.unparsed {
        color: #9a6a00;
    }

    .flag {
        display: block;
        font-size: 0.72rem;
        color: #9a6a00;
    }

    .blocked {
        margin: 0.2rem 0 0;
        font-size: 0.75rem;
        color: #b3261e;
    }

    .actions {
        display: flex;
        gap: 0.4rem;
        margin-top: 0.4rem;
    }

    .actions button {
        font: inherit;
        font-size: 0.8rem;
        padding: 0.15rem 0.5rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
    }

    .actions button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    button.danger {
        color: #b3261e;
        border-color: #d9a5a1;
    }

    .error {
        margin: 0;
        color: #b3261e;
        background: #fdeceb;
        border: 1px solid #f3c0bc;
        border-radius: 4px;
        padding: 0.4rem 0.6rem;
        font-size: 0.8rem;
        overflow-wrap: anywhere;
    }

    .error.small {
        margin: 0.3rem 0 0;
    }
</style>
