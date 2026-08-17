export type Permission = {
  type: 'api' | 'page';
  resource: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
};

export type Group = {
  name: string;
  permissions: readonly Permission[];
};

const wheelPermissions: Permission[] = [
  { type: 'api', resource: '/api/players', method: 'GET' },
  { type: 'api', resource: '/api/players', method: 'POST' },
  { type: 'api', resource: '/api/training-sessions', method: 'GET' },
  { type: 'api', resource: '/api/training-sessions/attendance', method: 'POST' },
  { type: 'api', resource: '/api/training-sessions/payment', method: 'POST' },
  { type: 'api', resource: '/api/caja', method: 'GET' },
  { type: 'api', resource: '/api/expenses', method: 'POST' },
  { type: 'api', resource: '/api/handoffs', method: 'POST' },
  { type: 'api', resource: '/api/handoffs/accept', method: 'POST' },
  { type: 'page', resource: '/' },
  { type: 'page', resource: '/caja' },
  { type: 'page', resource: '/players/new' },
  { type: 'page', resource: '/training-sessions' },
  { type: 'page', resource: '/training-sessions/*' },
  { type: 'page', resource: '/credencial' },
];

const rootPermissions: Permission[] = [
  ...wheelPermissions,
  { type: 'api', resource: '/api/payments/dues', method: 'POST' },
  { type: 'page', resource: '/payments' },
] as const;

export const GROUPS: Record<string, Group> = {
  WHEEL: {
    name: 'WHEEL',
    permissions: wheelPermissions,
  },
  ROOT: {
    name: 'ROOT',
    permissions: rootPermissions,
  },
};

function matchesResource(permResource: string, requestedResource: string): boolean {
  // Exact match
  if (permResource === requestedResource) return true;
  
  // Wildcard match: /training-sessions/* matches /training-sessions/2026-03-11-21
  if (permResource.endsWith('/*')) {
    const prefix = permResource.slice(0, -2); // Remove /*
    return requestedResource.startsWith(prefix + '/');
  }
  
  return false;
}

// Group membership lives in users.groups (resolved into the session at login);
// only the permission definitions stay in code.
export function hasPermission(
  userGroups: string[],
  type: 'api' | 'page',
  resource: string,
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
): boolean {
  for (const groupName of userGroups) {
    const group = GROUPS[groupName];
    if (!group) continue;

    const hasMatch = group.permissions.some((perm) => {
      if (perm.type !== type) return false;
      if (!matchesResource(perm.resource, resource)) return false;
      if (type === 'api' && method && perm.method !== method) return false;
      return true;
    });

    if (hasMatch) return true;
  }

  return false;
}

export const PUBLIC_ROUTES = [
  '/login',
  '/api/auth/telegram',
  '/api/auth/telegram/webapp',
  '/api/auth/whatsapp',
  '/api/auth/dev',
  '/api/me',
  '/api/check-permission',
  '/credencial',
  '/api/credencial/search',
  '/api/credencial/check',
  '/privacy-policy',
];

export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route));
}
