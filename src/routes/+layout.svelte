<script lang="ts">
    import { onMount, type Snippet } from 'svelte';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import favicon from '$lib/assets/favicon.svg';
    import { classStore } from '$lib/db/classes.svelte';
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

    // The sidebar's class list follows the open database.
    $effect(() => {
        if (connection.status === 'connected' && connection.database !== null) {
            void classStore.refresh();
        } else if (connection.status === 'disconnected') {
            classStore.clear();
        }
    });

    const live = $derived(
        connection.status === 'connected' || connection.status === 'reconnecting'
    );
    const inWorkspace = $derived(live && connection.database !== null);
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

{#if !booted}
    <p class="boot">Connecting…</p>
{:else if inWorkspace}
    <div class="workspace">
        <nav class="sidebar" aria-label="Classes">
            <h2>Classes</h2>
            <ul>
                {#each classStore.all as cls (cls.name)}
                    {@const href = resolve('/classes/[name]', { name: cls.name })}
                    <li>
                        <a
                            {href}
                            aria-current={page.url.pathname === href ||
                                page.url.pathname.startsWith(`${href}/`)}
                        >
                            {cls.plural}
                        </a>
                    </li>
                {/each}
            </ul>
            <a class="new-class" href={resolve('/classes/new')}>+ New class</a>
        </nav>
        <div class="content">
            {@render children()}
        </div>
    </div>
{:else}
    {@render children()}
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

    .workspace {
        display: flex;
        align-items: stretch;
        min-height: calc(100vh - 3rem);
    }

    .sidebar {
        width: 14rem;
        flex-shrink: 0;
        padding: 1rem;
        border-right: 1px solid #ddd;
        background: #fff;
    }

    .sidebar h2 {
        margin: 0 0 0.5rem;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #666;
    }

    .sidebar ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }

    .sidebar a {
        display: block;
        padding: 0.35rem 0.5rem;
        border-radius: 4px;
        color: inherit;
        text-decoration: none;
    }

    .sidebar a:hover {
        background: #f0f0f0;
    }

    .sidebar a[aria-current='true'] {
        background: #e8e8e8;
        font-weight: 600;
    }

    .new-class {
        margin-top: 0.75rem;
        color: #555;
        font-size: 0.9rem;
    }

    .content {
        flex: 1;
        min-width: 0;
    }
</style>
