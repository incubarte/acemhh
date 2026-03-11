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
      { type: 'page', resource: '/payments' },
      { type: 'page', resource: '/players/new' },
    ],
  },
  ROOT: {
    name: 'ROOT',
    permissions: [
      { type: 'api', resource: '/api/payments/dues', method: 'POST' },
      { type: 'api', resource: '/api/players', method: 'GET' },
      { type: 'api', resource: '/api/players', method: 'POST' },
      { type: 'page', resource: '/payments' },
      { type: 'page', resource: '/players/new' },
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
      if (perm.resource !== resource) return false;
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
