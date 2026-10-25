export type MemberRole = 'USER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'BLOCKED' | 'DELETED';
export type AuthTransport = 'browser' | 'native';

export interface PublicMember {
  id: string;
  email: string;
  name: string;
  role: MemberRole;
  status: AccountStatus;
  createdAt: string;
}

export const AUTH_POLICY = {
  accessLifetimeMs: 15 * 60_000,
  sessionLifetimeMs: 30 * 24 * 60 * 60_000,
  accessCookie: '__Host-sb_access',
  refreshCookie: '__Host-sb_refresh',
  csrfCookie: '__Host-sb_csrf',
} as const;
