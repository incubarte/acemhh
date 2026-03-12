export type Permission = {
  type: 'api' | 'page';
  resource: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
};

export type Group = {
  name: string;
  permissions: Permission[];
};

export type UserGroup = {
  userId: number;
  groups: string[];
};

export const GROUPS: Record<string, Group> = {
  WHEEL: {
    name: 'WHEEL',
    permissions: [
      { type: 'api', resource: '/api/players', method: 'GET' },
      { type: 'api', resource: '/api/players', method: 'POST' },
      { type: 'api', resource: '/api/training-sessions', method: 'GET' },
      { type: 'api', resource: '/api/training-sessions/attendance', method: 'POST' },
      { type: 'api', resource: '/api/training-sessions/payment', method: 'POST' },
      { type: 'page', resource: '/' },
      { type: 'page', resource: '/payments' },
      { type: 'page', resource: '/players/new' },
      { type: 'page', resource: '/training-sessions' },
      { type: 'page', resource: '/training-sessions/*' },
    ],
  },
  ROOT: {
    name: 'ROOT',
    permissions: [
      { type: 'api', resource: '/api/payments/dues', method: 'POST' },
      { type: 'api', resource: '/api/players', method: 'GET' },
      { type: 'api', resource: '/api/players', method: 'POST' },
      { type: 'api', resource: '/api/training-sessions', method: 'GET' },
      { type: 'api', resource: '/api/training-sessions/attendance', method: 'POST' },
      { type: 'api', resource: '/api/training-sessions/payment', method: 'POST' },
      { type: 'page', resource: '/' },
      { type: 'page', resource: '/payments' },
      { type: 'page', resource: '/players/new' },
      { type: 'page', resource: '/training-sessions' },
      { type: 'page', resource: '/training-sessions/*' },
    ],
  },
};

export const USER_GROUPS: UserGroup[] = [
  { userId: 45669763, groups: ['ROOT'] },
  { userId: 179767949, groups: ['WHEEL'] },
];

export function getUserGroups(userId: number): string[] {
  const userGroup = USER_GROUPS.find((ug) => ug.userId === userId);
  return userGroup?.groups ?? [];
}

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

export function hasPermission(
  userId: number,
  type: 'api' | 'page',
  resource: string,
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
): boolean {
  const userGroups = getUserGroups(userId);
  
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
  '/api/me',
  '/api/check-permission',
];

export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route));
}
