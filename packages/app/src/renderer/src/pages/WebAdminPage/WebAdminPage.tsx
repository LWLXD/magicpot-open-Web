import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import {
  History as HistoryIcon,
  Key as KeyIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  DeleteOutline as DeleteOutlineIcon
} from '@mui/icons-material'

type WebAdminUserSummary = MagicPotWebUser & {
  online: boolean
  onlineDurationSeconds: number
  sessionCount: number
  lastSeenAt?: string
  usageCount: number
}

type WebUsageEvent = {
  id: string
  userId: string
  type: string
  at: string
  metadata?: Record<string, unknown>
}

type WebAdminOverview = {
  users: WebAdminUserSummary[]
  totalUsers: number
  onlineUsers: number
}

function formatDate(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}小时 ${minutes}分钟`
  if (minutes > 0) return `${minutes}分钟`
  return `${seconds}秒`
}

function formatRelativeTime(value?: string): string {
  if (!value) return '-'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '-'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  })
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string | { message?: string }
  }
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message
    throw new Error(message || '请求失败')
  }
  return payload as T
}

const WebAdminPage: React.FC = () => {
  const [overview, setOverview] = useState<WebAdminOverview | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [history, setHistory] = useState<WebUsageEvent[]>([])
  const [passwordUser, setPasswordUser] = useState<WebAdminUserSummary | null>(null)
  const [password, setPassword] = useState('')
  const [deleteUserTarget, setDeleteUserTarget] = useState<WebAdminUserSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)

  const users = useMemo(() => overview?.users || [], [overview])
  const selectedUser = users.find((user) => user.id === selectedUserId) || null

  const loadOverview = useCallback(async () => {
    setError(null)
    try {
      setOverview(await adminFetch<WebAdminOverview>('/__magicpot/api/admin/overview'))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const updateUser = async (
    user: WebAdminUserSummary,
    patch: Partial<Pick<MagicPotWebUser, 'username' | 'role' | 'disabled'>>
  ) => {
    setSavingUserId(user.id)
    setError(null)
    try {
      await adminFetch(`/__magicpot/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })
      await loadOverview()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    } finally {
      setSavingUserId(null)
    }
  }

  const loadHistory = async (user: WebAdminUserSummary) => {
    setSelectedUserId(user.id)
    setError(null)
    try {
      const result = await adminFetch<{ usage: WebUsageEvent[] }>(
        `/__magicpot/api/admin/users/${encodeURIComponent(user.id)}/history`
      )
      setHistory(result.usage)
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : String(historyError))
    }
  }

  const submitPassword = async () => {
    if (!passwordUser) return
    setError(null)
    try {
      await adminFetch(
        `/__magicpot/api/admin/users/${encodeURIComponent(passwordUser.id)}/password`,
        {
          method: 'POST',
          body: JSON.stringify({ password })
        }
      )
      setPassword('')
      setPasswordUser(null)
      await loadOverview()
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : String(passwordError))
    }
  }

  const submitDeleteUser = async () => {
    if (!deleteUserTarget) return
    setDeletingUserId(deleteUserTarget.id)
    setError(null)
    try {
      await adminFetch(`/__magicpot/api/admin/users/${encodeURIComponent(deleteUserTarget.id)}`, {
        method: 'DELETE'
      })
      if (selectedUserId === deleteUserTarget.id) {
        setSelectedUserId(null)
        setHistory([])
      }
      setDeleteUserTarget(null)
      await loadOverview()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setDeletingUserId(null)
    }
  }

  return (
    <Box
      sx={(theme) => ({
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        p: 3,
        background:
          theme.palette.mode === 'dark'
            ? 'linear-gradient(180deg, #17171c 0%, #111114 100%)'
            : '#f7f8fb'
      })}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            管理后台
          </Typography>
          <Typography variant="body2" color="text.secondary">
            用户 {overview?.totalUsers ?? 0} 人，在线 {overview?.onlineUsers ?? 0} 人
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadOverview}>
          刷新
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} sx={{ borderRadius: 2, backgroundImage: 'none' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>角色</TableCell>
              <TableCell>用户名</TableCell>
              <TableCell>注册邮箱</TableCell>
              <TableCell>在线状态</TableCell>
              <TableCell>在线时长</TableCell>
              <TableCell>上次在线</TableCell>
              <TableCell>创建于</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell width={116}>
                  <Select
                    size="small"
                    value={user.role}
                    disabled={savingUserId === user.id}
                    onChange={(event) =>
                      void updateUser(user, { role: event.target.value as MagicPotWebUser['role'] })
                    }
                    sx={{ minWidth: 92 }}
                  >
                    <MenuItem value="admin">管理员</MenuItem>
                    <MenuItem value="user">用户</MenuItem>
                  </Select>
                </TableCell>
                <TableCell width={190}>
                  <TextField
                    size="small"
                    defaultValue={user.username}
                    disabled={savingUserId === user.id}
                    onBlur={(event) => {
                      const username = event.target.value.trim()
                      if (username && username !== user.username) {
                        void updateUser(user, { username })
                      }
                    }}
                  />
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={user.online ? 'success' : user.disabled ? 'default' : 'primary'}
                    variant={user.online ? 'filled' : 'outlined'}
                    label={user.disabled ? '已禁用' : user.online ? '在线' : '离线'}
                  />
                </TableCell>
                <TableCell>{formatDuration(user.onlineDurationSeconds)}</TableCell>
                <TableCell>
                  <Tooltip title={formatDate(user.lastSeenAt || user.lastLoginAt)}>
                    <Box component="span">
                      {user.online
                        ? '当前在线'
                        : formatRelativeTime(user.lastSeenAt || user.lastLoginAt)}
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell align="right">
                  <Stack
                    direction="row"
                    justifyContent="flex-end"
                    alignItems="center"
                    spacing={0.5}
                  >
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={!user.disabled}
                          disabled={savingUserId === user.id}
                          onChange={(event) =>
                            void updateUser(user, { disabled: !event.target.checked })
                          }
                        />
                      }
                      label="启用"
                    />
                    <Tooltip title="查看历史记录">
                      <IconButton size="small" onClick={() => void loadHistory(user)}>
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="修改密码">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setPasswordUser(user)
                          setPassword('')
                        }}
                      >
                        <KeyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="保存当前用户名">
                      <IconButton size="small" disabled>
                        <SaveIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除用户">
                      <IconButton
                        size="small"
                        color="error"
                        disabled={savingUserId === user.id || deletingUserId === user.id}
                        onClick={() => setDeleteUserTarget(user)}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUserId(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{selectedUser?.username} 的历史记录</DialogTitle>
        <DialogContent dividers>
          {history.length === 0 ? (
            <Typography color="text.secondary">暂无记录</Typography>
          ) : (
            <Stack spacing={1}>
              {history.map((item) => (
                <Box
                  key={item.id}
                  sx={(theme) => ({
                    p: 1.25,
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.divider}`
                  })}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {item.type}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(item.at)}
                  </Typography>
                  {item.metadata && (
                    <Typography
                      component="pre"
                      variant="caption"
                      sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5, mb: 0 }}
                    >
                      {JSON.stringify(item.metadata, null, 2)}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedUserId(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(passwordUser)}
        onClose={() => setPasswordUser(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>修改密码</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            目标用户：{passwordUser?.username} / {passwordUser?.email}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="新密码"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordUser(null)}>取消</Button>
          <Button variant="contained" onClick={submitPassword} disabled={password.length < 6}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deleteUserTarget)}
        onClose={() => setDeleteUserTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>删除用户</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            删除后，该账号将无法登录，相关会话和使用记录也会被移除。
          </Typography>
          <Typography variant="body2">
            确认删除用户 <strong>{deleteUserTarget?.username}</strong> / {deleteUserTarget?.email}？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteUserTarget(null)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={submitDeleteUser}
            disabled={!deleteUserTarget || deletingUserId === deleteUserTarget.id}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default WebAdminPage
