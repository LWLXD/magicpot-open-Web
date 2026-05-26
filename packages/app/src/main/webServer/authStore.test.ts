import { mkdir, mkdtemp, rm } from 'fs/promises'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { WebAuthStore } from './authStore'

async function withStore<T>(fn: (store: WebAuthStore) => Promise<T>): Promise<T> {
  const root = path.join(process.cwd(), 'node-tests', 'web-auth')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(path.join(root, 'store-'))
  try {
    const store = new WebAuthStore(dir)
    await store.init()
    return await fn(store)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('WebAuthStore', () => {
  it('creates the first registered user as admin', async () => {
    await withStore(async (store) => {
      const user = await store.register('Admin@Example.com', 'secret123', true)
      expect(user.email).toBe('admin@example.com')
      expect(user.role).toBe('admin')
    })
  })

  it('stores a provided registration username', async () => {
    await withStore(async (store) => {
      const user = await store.register('designer@example.com', 'secret123', true, '  设计师A  ')
      expect(user.email).toBe('designer@example.com')
      expect(user.username).toBe('设计师A')
    })
  })

  it('creates sessions that can be resolved and logged out', async () => {
    await withStore(async (store) => {
      await store.register('user@example.com', 'secret123', true)
      const login = await store.login('user@example.com', 'secret123', 1)
      await expect(store.resolveSession(login.token)).resolves.toMatchObject({
        email: 'user@example.com'
      })
      await store.logout(login.token)
      await expect(store.resolveSession(login.token)).resolves.toBeNull()
    })
  })

  it('records usage events per user', async () => {
    await withStore(async (store) => {
      const user = await store.register('user@example.com', 'secret123', true)
      await store.recordUsage(user.id, 'rpc.call', { serviceName: 'svcQApp' })
      expect(store.listUsage()).toHaveLength(1)
      expect(store.listUsage()[0]).toMatchObject({
        userId: user.id,
        type: 'rpc.call'
      })
    })
  })

  it('returns admin overview with online state and usage counts', async () => {
    await withStore(async (store) => {
      const user = await store.register('admin@example.com', 'secret123', true)
      await store.login('admin@example.com', 'secret123', 1)
      await store.recordUsage(user.id, 'rpc.call', { serviceName: 'svcQApp' })

      const overview = store.getAdminOverview()
      expect(overview.totalUsers).toBe(1)
      expect(overview.onlineUsers).toBe(1)
      expect(overview.users[0]).toMatchObject({
        email: 'admin@example.com',
        username: 'admin',
        role: 'admin',
        online: true,
        usageCount: 1
      })
    })
  })

  it('updates roles and resets passwords for managed users', async () => {
    await withStore(async (store) => {
      await store.register('admin@example.com', 'secret123', true)
      const user = await store.register('user@example.com', 'secret123', true)

      await store.updateUser(user.id, { username: 'designer', role: 'admin' })
      expect(store.listUsers().find((item) => item.id === user.id)).toMatchObject({
        username: 'designer',
        role: 'admin'
      })

      await store.setPassword(user.id, 'newpass123')
      await expect(store.login('user@example.com', 'newpass123', 1)).resolves.toMatchObject({
        user: { email: 'user@example.com' }
      })
    })
  })

  it('deletes managed users and clears their sessions and history', async () => {
    await withStore(async (store) => {
      await store.register('admin@example.com', 'secret123', true)
      const user = await store.register('user@example.com', 'secret123', true)
      const login = await store.login('user@example.com', 'secret123', 1)
      await store.recordUsage(user.id, 'qapp.run')

      await store.deleteUser(user.id)

      expect(store.listUsers().some((item) => item.id === user.id)).toBe(false)
      await expect(store.resolveSession(login.token)).resolves.toBeNull()
      expect(store.getUserHistory(user.id)).toHaveLength(0)
    })
  })

  it('protects the current and final available admin from deletion', async () => {
    await withStore(async (store) => {
      const admin = await store.register('admin@example.com', 'secret123', true)

      await expect(store.deleteUser(admin.id, admin.id)).rejects.toThrow('不能删除当前登录账号')
      await expect(store.deleteUser(admin.id)).rejects.toThrow('至少需要保留一个可用管理员')
    })
  })
})
