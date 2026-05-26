import crypto from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import {
  PublicWebUser,
  WebAdminOverview,
  WebAdminUserSummary,
  WebServerSession,
  WebServerState,
  WebServerUser,
  WebUsageEvent,
  WebUserPermissions,
  WebUserRole
} from './types'

const STATE_FILE = 'web-server-state.json'
const SCHEMA_VERSION = 1
const PASSWORD_ITERATIONS = 210_000
const PASSWORD_KEY_LENGTH = 32
const PASSWORD_DIGEST = 'sha256'
const ONLINE_WINDOW_MS = 2 * 60 * 1000

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function usernameFromEmail(email: string): string {
  return normalizeEmail(email).split('@')[0] || 'user'
}

function permissionsForRole(role: WebUserRole): WebUserPermissions {
  const admin = role === 'admin'
  return {
    canAccessSettings: admin,
    canAccessWorkshop: admin,
    canManageUsers: admin
  }
}

function toPublicUser(user: WebServerUser): PublicWebUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username || usernameFromEmail(user.email),
    role: user.role,
    permissions: permissionsForRole(user.role),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    disabled: user.disabled
  }
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      PASSWORD_ITERATIONS,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
      (error, key) => {
        if (error) reject(error)
        else resolve(key.toString('hex'))
      }
    )
  })
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export class WebAuthStore {
  private state: WebServerState = {
    schemaVersion: SCHEMA_VERSION,
    users: [],
    sessions: [],
    usage: []
  }

  constructor(private readonly userDataDir: string) {}

  private get statePath(): string {
    return path.join(this.userDataDir, STATE_FILE)
  }

  async init(): Promise<void> {
    await mkdir(this.userDataDir, { recursive: true })
    try {
      const raw = await readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw) as WebServerState
      this.state = {
        schemaVersion: SCHEMA_VERSION,
        users: Array.isArray(parsed.users)
          ? parsed.users.map((user) => ({
              ...user,
              username: user.username || usernameFromEmail(user.email)
            }))
          : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        usage: Array.isArray(parsed.usage) ? parsed.usage : []
      }
      await this.pruneExpiredSessions()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      await this.save()
    }
  }

  hasUsers(): boolean {
    return this.state.users.length > 0
  }

  async register(
    email: string,
    password: string,
    allowRegistration: boolean,
    username?: string
  ): Promise<PublicWebUser> {
    const normalizedEmail = normalizeEmail(email)
    const normalizedUsername = typeof username === 'string' ? username.trim() : ''
    if (!normalizedEmail.includes('@')) {
      throw new Error('请输入有效邮箱')
    }
    if (typeof username === 'string' && !normalizedUsername) {
      throw new Error('用户名不能为空')
    }
    if (password.length < 6) {
      throw new Error('密码至少需要 6 位')
    }
    if (this.hasUsers() && !allowRegistration) {
      throw new Error('当前服务器暂未开放注册')
    }
    if (this.state.users.some((user) => user.email === normalizedEmail)) {
      throw new Error('该邮箱已经注册')
    }

    const salt = crypto.randomBytes(16).toString('hex')
    const user: WebServerUser = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      username: normalizedUsername || usernameFromEmail(normalizedEmail),
      passwordHash: await hashPassword(password, salt),
      passwordSalt: salt,
      passwordIterations: PASSWORD_ITERATIONS,
      role: this.hasUsers() ? 'user' : 'admin',
      createdAt: nowIso()
    }
    this.state.users.push(user)
    await this.save()
    return toPublicUser(user)
  }

  async login(
    email: string,
    password: string,
    ttlHours: number
  ): Promise<{ user: PublicWebUser; token: string; expiresAt: string }> {
    const normalizedEmail = normalizeEmail(email)
    const user = this.state.users.find((item) => item.email === normalizedEmail)
    if (!user || user.disabled) {
      throw new Error('邮箱或密码错误')
    }

    const passwordHash = await hashPassword(password, user.passwordSalt)
    if (!safeEqual(passwordHash, user.passwordHash)) {
      throw new Error('邮箱或密码错误')
    }

    const token = crypto.randomBytes(32).toString('hex')
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 60 * 60 * 1000).toISOString()
    user.lastLoginAt = createdAt
    this.state.sessions.push({
      token,
      userId: user.id,
      createdAt,
      expiresAt,
      lastSeenAt: createdAt,
      onlineSinceAt: createdAt
    })
    await this.save()
    return { user: toPublicUser(user), token, expiresAt }
  }

  async logout(token: string): Promise<void> {
    this.state.sessions = this.state.sessions.filter((session) => session.token !== token)
    await this.save()
  }

  async resolveSession(token: string | null): Promise<PublicWebUser | null> {
    if (!token) return null
    const session = this.state.sessions.find((item) => item.token === token)
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.pruneExpiredSessions()
      return null
    }
    const user = this.state.users.find((item) => item.id === session.userId && !item.disabled)
    if (!user) return null
    const now = Date.now()
    const lastSeenAt = new Date(session.lastSeenAt).getTime()
    if (!session.onlineSinceAt || now - lastSeenAt > ONLINE_WINDOW_MS) {
      session.onlineSinceAt = new Date(now).toISOString()
    }
    session.lastSeenAt = new Date(now).toISOString()
    await this.save()
    return toPublicUser(user)
  }

  async recordUsage(
    userId: string,
    type: string,
    metadata?: Record<string, unknown>
  ): Promise<WebUsageEvent> {
    const event: WebUsageEvent = {
      id: crypto.randomUUID(),
      userId,
      type,
      at: nowIso(),
      metadata
    }
    this.state.usage.push(event)
    if (this.state.usage.length > 10_000) {
      this.state.usage = this.state.usage.slice(-10_000)
    }
    await this.save()
    return event
  }

  listUsers(): PublicWebUser[] {
    return this.state.users.map(toPublicUser)
  }

  listUsage(): WebUsageEvent[] {
    return [...this.state.usage].sort((a, b) => b.at.localeCompare(a.at))
  }

  getAdminOverview(): WebAdminOverview {
    const users = this.state.users.map((user) => this.toAdminUserSummary(user))
    return {
      users,
      totalUsers: users.length,
      onlineUsers: users.filter((user) => user.online).length
    }
  }

  getUserHistory(userId: string): WebUsageEvent[] {
    return this.state.usage
      .filter((event) => event.userId === userId)
      .sort((a, b) => b.at.localeCompare(a.at))
  }

  async updateUser(
    userId: string,
    patch: {
      username?: string
      role?: WebUserRole
      disabled?: boolean
    }
  ): Promise<PublicWebUser> {
    const user = this.getUserOrThrow(userId)
    if (typeof patch.username === 'string') {
      const username = patch.username.trim()
      if (!username) throw new Error('用户名不能为空')
      user.username = username
    }
    if (patch.role) {
      if (patch.role !== 'admin' && patch.role !== 'user') {
        throw new Error('权限等级无效')
      }
      this.assertCanChangeAdminState(user, patch.role, patch.disabled)
      user.role = patch.role
    }
    if (typeof patch.disabled === 'boolean') {
      this.assertCanChangeAdminState(user, patch.role, patch.disabled)
      user.disabled = patch.disabled
      if (patch.disabled) {
        this.state.sessions = this.state.sessions.filter((session) => session.userId !== user.id)
      }
    }
    await this.save()
    return toPublicUser(user)
  }

  async setPassword(userId: string, password: string, preserveToken?: string): Promise<void> {
    if (password.length < 6) {
      throw new Error('密码至少需要 6 位')
    }
    const user = this.getUserOrThrow(userId)
    const salt = crypto.randomBytes(16).toString('hex')
    user.passwordSalt = salt
    user.passwordHash = await hashPassword(password, salt)
    user.passwordIterations = PASSWORD_ITERATIONS
    this.state.sessions = this.state.sessions.filter(
      (session) => session.userId !== user.id || session.token === preserveToken
    )
    await this.save()
  }

  async deleteUser(userId: string, actingUserId?: string): Promise<void> {
    const user = this.getUserOrThrow(userId)
    if (actingUserId && user.id === actingUserId) {
      throw new Error('不能删除当前登录账号')
    }
    if (user.role === 'admin') {
      const activeAdminCount = this.state.users.filter(
        (item) => item.role === 'admin' && !item.disabled
      ).length
      if (!user.disabled && activeAdminCount <= 1) {
        throw new Error('至少需要保留一个可用管理员')
      }
    }

    this.state.users = this.state.users.filter((item) => item.id !== user.id)
    this.state.sessions = this.state.sessions.filter((session) => session.userId !== user.id)
    this.state.usage = this.state.usage.filter((event) => event.userId !== user.id)
    await this.save()
  }

  private async pruneExpiredSessions(): Promise<void> {
    const before = this.state.sessions.length
    const now = Date.now()
    this.state.sessions = this.state.sessions.filter(
      (session) => new Date(session.expiresAt).getTime() > now
    )
    if (this.state.sessions.length !== before) {
      await this.save()
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
  }

  private getUserOrThrow(userId: string): WebServerUser {
    const user = this.state.users.find((item) => item.id === userId)
    if (!user) throw new Error('用户不存在')
    return user
  }

  private activeSessionsForUser(userId: string): WebServerSession[] {
    const now = Date.now()
    return this.state.sessions.filter(
      (session) =>
        session.userId === userId &&
        new Date(session.expiresAt).getTime() > now &&
        now - new Date(session.lastSeenAt).getTime() <= ONLINE_WINDOW_MS
    )
  }

  private toAdminUserSummary(user: WebServerUser): WebAdminUserSummary {
    const activeSessions = this.activeSessionsForUser(user.id)
    const latestSession = activeSessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]
    const now = Date.now()
    return {
      ...toPublicUser(user),
      online: Boolean(latestSession),
      onlineDurationSeconds: latestSession
        ? Math.max(
            0,
            Math.floor(
              (now - new Date(latestSession.onlineSinceAt || latestSession.lastSeenAt).getTime()) /
                1000
            )
          )
        : 0,
      sessionCount: this.state.sessions.filter((session) => session.userId === user.id).length,
      lastSeenAt: latestSession?.lastSeenAt,
      usageCount: this.state.usage.filter((event) => event.userId === user.id).length
    }
  }

  private assertCanChangeAdminState(
    user: WebServerUser,
    nextRole = user.role,
    nextDisabled = Boolean(user.disabled)
  ): void {
    if (user.role !== 'admin') return
    const activeAdminCount = this.state.users.filter(
      (item) => item.role === 'admin' && !item.disabled
    ).length
    const wouldRemoveAdmin = nextRole !== 'admin' || nextDisabled
    if (wouldRemoveAdmin && activeAdminCount <= 1) {
      throw new Error('至少需要保留一个可用管理员')
    }
  }
}
