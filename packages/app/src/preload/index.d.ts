// packages/app/src/preload/index.d.ts
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from '@shared/api'
import type { BuiltInPath, WinBridge } from '@shared/utils/utilWindow'

export type ElectronFileBridge = {
  getPathForFile(file: File): string
}

declare global {
  type MagicPotWebUserRole = 'admin' | 'user'
  type MagicPotWebUserPermissions = {
    canAccessSettings: boolean
    canAccessWorkshop: boolean
    canManageUsers: boolean
  }
  type MagicPotWebUser = {
    id: string
    email: string
    username: string
    role: MagicPotWebUserRole
    permissions: MagicPotWebUserPermissions
    createdAt: string
    lastLoginAt?: string
    disabled?: boolean
  }

  interface Window {
    __MAGICPOT_WEB_RUNTIME__?: boolean
    __MAGICPOT_WEB__?: {
      user?: MagicPotWebUser
    }
    electron: ElectronAPI
    electronFile?: ElectronFileBridge
    api: Api
    path: BuiltInPath
    win: WinBridge
  }
}
export {}
