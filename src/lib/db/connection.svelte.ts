/**
 * Singleton SurrealDB connection controller (spec §3, §8).
 *
 * Holds the one live `Surreal` client and mirrors its lifecycle events into
 * reactive state. All errors are surfaced verbatim — the client never
 * second-guesses the database ("smart database, dumb client").
 */

import { Surreal } from 'surrealdb';
import type { SystemAuth } from 'surrealdb';
import { systemAuth } from './auth';
import { profiles, type ConnectionProfile } from './profiles.svelte';

export type ConnectionStatus =
    'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

let client: Surreal | null = null;
let unsubscribers: (() => void)[] = [];

let status = $state<ConnectionStatus>('disconnected');
let serverVersion = $state<string | null>(null);
let errorMessage = $state<string | null>(null);
let activeProfileId = $state<string | null>(null);
let namespace = $state<string | null>(null);
let database = $state<string | null>(null);

function toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function buildAuthentication(profile: ConnectionProfile, password: string): SystemAuth | undefined {
    return systemAuth({
        level: profile.auth.level,
        namespace: profile.namespace,
        database: profile.database,
        username: profile.auth.username,
        password
    });
}

function attach(db: Surreal): void {
    unsubscribers = [
        db.subscribe('connecting', () => (status = 'connecting')),
        db.subscribe('connected', (version) => {
            status = 'connected';
            serverVersion = version;
        }),
        db.subscribe('reconnecting', () => (status = 'reconnecting')),
        db.subscribe('disconnected', () => (status = 'disconnected')),
        db.subscribe('error', (err) => {
            status = 'error';
            errorMessage = toMessage(err);
        }),
        db.subscribe('using', (selected) => {
            namespace = selected.namespace ?? null;
            database = selected.database ?? null;
        })
    ];
}

async function teardown(): Promise<void> {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers = [];
    if (client) {
        try {
            await client.close();
        } catch (err) {
            // Closing an already-dead socket is not actionable; note it and move on.
            console.warn('Parallax: error while closing connection', err);
        }
        client = null;
    }
    status = 'disconnected';
    serverVersion = null;
    activeProfileId = null;
    namespace = null;
    database = null;
}

export const connection = {
    get status(): ConnectionStatus {
        return status;
    },
    get serverVersion(): string | null {
        return serverVersion;
    },
    get error(): string | null {
        return errorMessage;
    },
    get activeProfile(): ConnectionProfile | undefined {
        return activeProfileId === null ? undefined : profiles.byId(activeProfileId);
    },
    get namespace(): string | null {
        return namespace;
    },
    get database(): string | null {
        return database;
    },

    /** The live client, for feature modules (databases, class designer, ...). */
    get client(): Surreal {
        if (!client) throw new Error('Not connected to a database');
        return client;
    },

    /**
     * Connect and authenticate. Database-level profiles land directly in
     * their fixed database; all other levels connect to the server only and
     * pick a database afterwards (spec §8 two-step flow).
     */
    async connect(profile: ConnectionProfile, password = ''): Promise<void> {
        await teardown();
        const db = new Surreal();
        client = db;
        attach(db);
        status = 'connecting';
        errorMessage = null;
        try {
            const authentication = buildAuthentication(profile, password);
            const isDatabaseLevel = profile.auth.level === 'database';
            await db.connect(profile.url, {
                ...(authentication ? { authentication } : {}),
                ...(isDatabaseLevel
                    ? { namespace: profile.namespace, database: profile.database }
                    : {})
            });
            activeProfileId = profile.id;
            profiles.markUsed(profile.id, isDatabaseLevel ? profile.database : undefined);
        } catch (err) {
            errorMessage = toMessage(err);
            status = 'error';
            throw err;
        }
    },

    /** Select the profile's namespace on the live session. */
    async selectNamespace(): Promise<void> {
        const profile = this.activeProfile;
        if (!profile) throw new Error('Not connected to a database');
        await this.client.use({ namespace: profile.namespace });
    },

    /** Open a database within the already-selected namespace. */
    async openDatabase(name: string): Promise<void> {
        await this.client.use({ database: name });
        if (activeProfileId !== null) profiles.markUsed(activeProfileId, name);
    },

    /**
     * One-shot silent reconnect on app launch (spec §8): last-used profile,
     * only when a password is available without prompting. Returns true when
     * the session is fully restored (connected and database open).
     */
    async autoReconnect(): Promise<boolean> {
        const profile = profiles.lastActive;
        if (!profile) return false;
        const passwordless = profile.auth.level === 'anonymous';
        if (!passwordless && profile.password === undefined) return false;
        try {
            await this.connect(profile, profile.password ?? '');
            if (profile.auth.level === 'database') return true;
            if (profile.lastDatabase === undefined) return false;
            await this.selectNamespace();
            await this.openDatabase(profile.lastDatabase);
            return true;
        } catch {
            // The connect page will show the stored error state.
            return false;
        }
    },

    async disconnect(): Promise<void> {
        await teardown();
    }
};
