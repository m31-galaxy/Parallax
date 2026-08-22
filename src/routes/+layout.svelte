<script lang="ts">
    import { onMount, type Snippet } from 'svelte';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import favicon from '$lib/assets/favicon.svg';
    import { connection } from '$lib/db/connection.svelte';

    let { children }: { children: Snippet } = $props();

    let booted = $state(false);

    // One-shot silent auto-reconnect on launch (spec §8).
    onMount(() => {
        void (async () => {
            const restored = await connection.autoReconnect();
            if (!restored && page.url.pathname !== resolve('/connect'))
                await goto(resolve('/connect'));
            booted = true;
        })();
    });

    // Gate: everything outside /connect needs a live session with an open database.
    $effect(() => {
        if (!booted || page.url.pathname === '/connect') return;
        const gated =
            connection.status === 'disconnected' ||
            connection.status === 'error' ||
            (connection.status === 'connected' && connection.database === null);
        if (gated) void goto(resolve('/connect'));
    });

    const live = $derived(
        connection.status === 'connected' || connection.status === 'reconnecting'
    );
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
    <title>Parallax</title>
</svelte:head>

{#if live}
    <header>
        <strong>Parallax</strong>
        <span class="session">
            {connection.activeProfile?.name}
            {#if connection.database}
                · {connection.namespace}/{connection.database}
            {/if}
        </span>
        <span class="status" data-status={connection.status}>{connection.status}</span>
        <button onclick={() => void connection.disconnect()}>Disconnect</button>
    </header>
{/if}

{#if booted}
    {@render children()}
{:else}
    <p class="boot">Connecting…</p>
{/if}

<style>
    :global(body) {
        margin: 0;
        font-family: system-ui, sans-serif;
        color: #1a1a1a;
        background: #fafafa;
    }

    header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 1rem;
        border-bottom: 1px solid #ddd;
        background: #fff;
    }

    .session {
        color: #555;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .status {
        margin-left: auto;
        font-size: 0.8rem;
        color: #2a7a2a;
    }

    .status[data-status='reconnecting'] {
        color: #b57700;
    }

    .boot {
        padding: 2rem;
        color: #555;
    }
</style>
