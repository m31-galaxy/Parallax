/**
 * Database management (spec §8): the user's databases live inside the
 * profile's namespace. Identifiers cannot be bound as query parameters, so
 * names are escaped with the SDK's own escapeIdent; every failure surfaces
 * the server's verbatim error.
 *
 * Privilege reality (surfaced, not enforced): DEFINE NAMESPACE needs a
 * root-level editor/owner, DEFINE DATABASE needs namespace-level or above.
 */

import { escapeIdent, type Surreal } from 'surrealdb';

interface NamespaceInfo {
    databases?: Record<string, string>;
}

/** List the databases visible in the currently selected namespace. */
export async function listDatabases(db: Surreal): Promise<string[]> {
    const [info] = await db.query<[NamespaceInfo]>('INFO FOR NS');
    return Object.keys(info?.databases ?? {}).sort((a, b) => a.localeCompare(b));
}

/** Create a database in the currently selected namespace. */
export async function createDatabase(db: Surreal, name: string): Promise<void> {
    await db.query(`DEFINE DATABASE ${escapeIdent(name)}`);
}

/** Create the profile's namespace if it does not exist yet. */
export async function createNamespace(db: Surreal, name: string): Promise<void> {
    await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${escapeIdent(name)}`);
}
