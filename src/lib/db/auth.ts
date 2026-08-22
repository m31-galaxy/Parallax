/**
 * SurrealDB system-user credential shapes (spec §8): the shape *is* the auth
 * level — root is bare username/password, namespace and database users add
 * their containers, anonymous sends no authentication at all. Shared by the
 * web app's connection controller and the MCP server.
 */

import type { SystemAuth } from 'surrealdb';

export type AuthLevel = 'anonymous' | 'root' | 'namespace' | 'database';

export const AUTH_LEVELS: readonly AuthLevel[] = ['anonymous', 'root', 'namespace', 'database'];

export interface AuthTarget {
    level: AuthLevel;
    namespace: string;
    /** Required for database-level credentials. */
    database?: string;
    username?: string;
    password?: string;
}

export function systemAuth(target: AuthTarget): SystemAuth | undefined {
    const { level, namespace, database, username, password = '' } = target;
    if (level === 'anonymous') return undefined;
    if (!username) throw new Error(`${level}-level authentication requires a username`);
    switch (level) {
        case 'root':
            return { username, password };
        case 'namespace':
            return { namespace, username, password };
        case 'database': {
            if (!database) throw new Error('database-level authentication requires a database');
            return { namespace, database, username, password };
        }
    }
}
