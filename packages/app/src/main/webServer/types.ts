export type WebUserRole = 'admin' | 'user'

export type WebUserPermissions = {
  canAccessSettings: boolean
  canAccessWorkshop: boolean
  canManageUsers: boolean
}

export type WebServerUser = {
  id: string
  email: string
  username?: string
  passwordHash: string
  passwordSalt: string
  passwordIterations: number
  role: WebUserRole
  createdAt: string
  lastLoginAt?: string
  disabled?: boolean
}

export type WebServerSession = {
  token: string
  userId: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string
  onlineSinceAt?: string
}

export type WebUsageEvent = {
  id: string
  userId: string
  type: string
  at: string
  metadata?: Record<string, unknown>
}

export type WebServerState = {
  schemaVersion: 1
  users: WebServerUser[]
  sessions: WebServerSession[]
  usage: WebUsageEvent[]
}

export type PublicWebUser = {
  id: string
  email: string
  username: string
  role: WebUserRole
  permissions: WebUserPermissions
  createdAt: string
  lastLoginAt?: string
  disabled?: boolean
}

export type WebAdminUserSummary = PublicWebUser & {
  online: boolean
  onlineDurationSeconds: number
  sessionCount: number
  lastSeenAt?: string
  usageCount: number
}

export type WebAdminOverview = {
  users: WebAdminUserSummary[]
  totalUsers: number
  onlineUsers: number
}
