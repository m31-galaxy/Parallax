<script lang="ts">
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { connection } from '$lib/db/connection.svelte';
    import {
        DEFAULT_NAMESPACE,
        profiles,
        type AuthLevel,
        type ConnectionProfile
    } from '$lib/db/profiles.svelte';
    import { createNamespace, createDatabase, listDatabases } from '$lib/db/databases';

    const LEVELS: { value: AuthLevel; label: string; hint: string }[] = [
        { value: 'root', label: 'Root user', hint: 'Whole server — every namespace and database' },
        {
            value: 'namespace',
            label: 'Namespace user',
            hint: 'All databases within the namespace'
        },
        {
            value: 'database',
            label: 'Database user',
            hint: 'A single database; connects straight into it'
        },
        { value: 'anonymous', label: 'Anonymous', hint: 'Unauthenticated server (dev/testing)' }
    ];

    interface Draft {
        id: string | null;
        name: string;
        url: string;
        level: AuthLevel;
        username: string;
        password: string;
        remember: boolean;
        namespace: string;
        database: string;
    }

    function emptyDraft(): Draft {
        return {
            id: null,
            name: '',
            url: 'ws://localhost:8000',
            level: 'root',
            username: 'root',
            password: '',
            remember: false,
            namespace: DEFAULT_NAMESPACE,
            database: ''
        };
    }

    let draft = $state(emptyDraft());
    let formOpen = $state(false);
    let busy = $state(false);

    // Inline password prompt for saved profiles without a stored password.
    let promptProfileId = $state<string | null>(null);
    let promptPassword = $state('');

    // Database step state.
    let databases = $state<string[] | null>(null);
    let databaseError = $state<string | null>(null);
    let newDatabaseName = $state('');

    const needsPassword = $derived(draft.level !== 'anonymous');
    const inDatabaseStep = $derived(
        connection.status === 'connected' &&
            connection.activeProfile !== undefined &&
            connection.activeProfile.auth.level !== 'database' &&
            connection.database === null
    );

    $effect(() => {
        if (inDatabaseStep) void loadDatabases();
    });

    function toMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    async function connectWith(profile: ConnectionProfile, password: string): Promise<void> {
        busy = true;
        try {
            await connection.connect(profile, password);
            if (profile.auth.level === 'database') await goto(resolve('/'));
        } catch {
            // connection.error carries the database's verbatim message.
        } finally {
            busy = false;
            promptProfileId = null;
            promptPassword = '';
        }
    }

    function connectSaved(profile: ConnectionProfile): void {
        if (profile.auth.level === 'anonymous') {
            void connectWith(profile, '');
        } else if (profile.password !== undefined) {
            void connectWith(profile, profile.password);
        } else {
            promptProfileId = profile.id;
            promptPassword = '';
        }
    }

    function submitDraft(): void {
        const existing = draft.id === null ? undefined : profiles.byId(draft.id);
        const profile: ConnectionProfile = {
            id: draft.id ?? crypto.randomUUID(),
            name: draft.name.trim() || draft.url.trim(),
            url: draft.url.trim(),
            namespace: draft.namespace.trim() || DEFAULT_NAMESPACE,
            auth: {
                level: draft.level,
                username: draft.level === 'anonymous' ? undefined : draft.username.trim()
            },
            database: draft.level === 'database' ? draft.database.trim() : undefined,
            rememberPassword: draft.remember,
            password: draft.remember ? draft.password : undefined,
            lastDatabase: existing?.lastDatabase,
            lastUsedAt: existing?.lastUsedAt
        };
        profiles.save(profile);
        const password = draft.level === 'anonymous' ? '' : draft.password;
        formOpen = false;
        draft = emptyDraft();
        void connectWith(profile, password);
    }

    function editProfile(profile: ConnectionProfile): void {
        draft = {
            id: profile.id,
            name: profile.name,
            url: profile.url,
            level: profile.auth.level,
            username: profile.auth.username ?? '',
            password: profile.password ?? '',
            remember: profile.rememberPassword,
            namespace: profile.namespace,
            database: profile.database ?? ''
        };
        formOpen = true;
    }

    async function loadDatabases(): Promise<void> {
        databases = null;
        databaseError = null;
        try {
            await connection.selectNamespace();
            databases = await listDatabases(connection.client);
        } catch (err) {
            databaseError = toMessage(err);
            databases = [];
        }
    }

    async function openDatabase(name: string): Promise<void> {
        busy = true;
        try {
            await connection.openDatabase(name);
            await goto(resolve('/'));
        } catch (err) {
            databaseError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    async function makeDatabase(): Promise<void> {
        const name = newDatabaseName.trim();
        if (name === '') return;
        busy = true;
        try {
            await createDatabase(connection.client, name);
            newDatabaseName = '';
            await openDatabase(name);
        } catch (err) {
            databaseError = toMessage(err);
            busy = false;
        }
    }

    async function makeNamespace(): Promise<void> {
        busy = true;
        try {
            await createNamespace(connection.client, connection.activeProfile?.namespace ?? '');
            await loadDatabases();
        } catch (err) {
            databaseError = toMessage(err);
        } finally {
            busy = false;
        }
    }
</script>

<main>
    {#if inDatabaseStep}
        <section>
            <h1>Choose a database</h1>
            <p class="muted">
                Namespace <code>{connection.activeProfile?.namespace}</code> on
                <code>{connection.activeProfile?.url}</code>
            </p>

            {#if databases === null}
                <p class="muted">Loading databases…</p>
            {:else}
                {#if databaseError !== null}
                    <p class="error">{databaseError}</p>
                    <button disabled={busy} onclick={() => void makeNamespace()}>
                        Create namespace “{connection.activeProfile?.namespace}”
                    </button>
                {/if}

                {#if databases.length > 0}
                    <ul class="databases">
                        {#each databases as databaseName (databaseName)}
                            <li>
                                <button
                                    disabled={busy}
                                    onclick={() => void openDatabase(databaseName)}
                                >
                                    {databaseName}
                                </button>
                            </li>
                        {/each}
                    </ul>
                {:else if databaseError === null}
                    <p class="muted">No databases yet — create your first one below.</p>
                {/if}

                <form
                    onsubmit={(event) => {
                        event.preventDefault();
                        void makeDatabase();
                    }}
                >
                    <label>
                        New database
                        <input bind:value={newDatabaseName} placeholder="journal" />
                    </label>
                    <button type="submit" disabled={busy || newDatabaseName.trim() === ''}>
                        Create database
                    </button>
                </form>
            {/if}

            <button class="linkish" onclick={() => void connection.disconnect()}>
                ← Back to servers
            </button>
        </section>
    {:else}
        <section>
            <h1>Connect to a database</h1>

            {#if connection.error !== null}
                <p class="error">{connection.error}</p>
            {/if}

            {#if profiles.all.length > 0}
                <ul class="profiles">
                    {#each profiles.all as profile (profile.id)}
                        <li>
                            <div class="profile-row">
                                <div>
                                    <strong>{profile.name}</strong>
                                    <span class="muted">
                                        {profile.url} ·
                                        {LEVELS.find((l) => l.value === profile.auth.level)?.label}
                                        {#if profile.auth.username}
                                            ({profile.auth.username}){/if}
                                    </span>
                                </div>
                                <div class="actions">
                                    <button disabled={busy} onclick={() => connectSaved(profile)}>
                                        Connect
                                    </button>
                                    <button disabled={busy} onclick={() => editProfile(profile)}>
                                        Edit
                                    </button>
                                    <button
                                        disabled={busy}
                                        onclick={() => profiles.remove(profile.id)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                            {#if promptProfileId === profile.id}
                                <form
                                    class="password-prompt"
                                    onsubmit={(event) => {
                                        event.preventDefault();
                                        void connectWith(profile, promptPassword);
                                    }}
                                >
                                    <label>
                                        Password for {profile.auth.username}
                                        <input type="password" bind:value={promptPassword} />
                                    </label>
                                    <button type="submit" disabled={busy}>Connect</button>
                                </form>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}

            {#if formOpen}
                <form
                    class="profile-form"
                    onsubmit={(event) => {
                        event.preventDefault();
                        submitDraft();
                    }}
                >
                    <label>
                        Profile name
                        <input bind:value={draft.name} placeholder="My server" />
                    </label>
                    <label>
                        Server URL
                        <input bind:value={draft.url} required placeholder="ws://localhost:8000" />
                    </label>
                    <label>
                        Authentication
                        <select bind:value={draft.level}>
                            {#each LEVELS as level (level.value)}
                                <option value={level.value}>{level.label} — {level.hint}</option>
                            {/each}
                        </select>
                    </label>
                    {#if needsPassword}
                        <label>
                            Username
                            <input bind:value={draft.username} required />
                        </label>
                        <label>
                            Password
                            <input type="password" bind:value={draft.password} />
                        </label>
                        <label class="checkbox">
                            <input type="checkbox" bind:checked={draft.remember} />
                            Remember password
                            <span class="muted">(stored as plaintext in this browser)</span>
                        </label>
                    {/if}
                    {#if draft.level === 'database'}
                        <label>
                            Database
                            <input bind:value={draft.database} required placeholder="journal" />
                        </label>
                    {/if}
                    <details>
                        <summary>Advanced</summary>
                        <label>
                            Namespace
                            <input bind:value={draft.namespace} placeholder={DEFAULT_NAMESPACE} />
                        </label>
                    </details>
                    <div class="actions">
                        <button type="submit" disabled={busy}>Save & connect</button>
                        <button
                            type="button"
                            onclick={() => {
                                formOpen = false;
                                draft = emptyDraft();
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            {:else}
                <button onclick={() => (formOpen = true)}>New connection…</button>
            {/if}
        </section>
    {/if}
</main>

<style>
    main {
        max-width: 34rem;
        margin: 0 auto;
        padding: 2rem 1rem;
    }

    h1 {
        font-size: 1.4rem;
    }

    .muted {
        color: #666;
        font-size: 0.9rem;
    }

    .error {
        color: #b3261e;
        background: #fdeceb;
        border: 1px solid #f3c0bc;
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
        overflow-wrap: anywhere;
    }

    ul {
        list-style: none;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .profile-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 0.6rem 0.8rem;
        background: #fff;
    }

    .profile-row .muted {
        display: block;
    }

    .actions {
        display: flex;
        gap: 0.4rem;
        flex-shrink: 0;
    }

    form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 1rem;
        background: #fff;
        margin-top: 0.75rem;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }

    label.checkbox {
        flex-direction: row;
        align-items: center;
        gap: 0.4rem;
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
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    button.linkish {
        border: none;
        background: none;
        color: #555;
        padding: 0.75rem 0;
    }

    .databases button {
        width: 100%;
        text-align: left;
        padding: 0.6rem 0.8rem;
    }

    .password-prompt {
        margin-top: 0.35rem;
    }
</style>
