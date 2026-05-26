import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import { getMagicPotWebUser } from '../../utils/webRuntime'

async function accountFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

function updateInjectedUser(user: MagicPotWebUser): void {
  if (window.__MAGICPOT_WEB__) {
    window.__MAGICPOT_WEB__.user = user
  }
}

const WebAccountPage: React.FC = () => {
  const [user, setUser] = useState<MagicPotWebUser | null>(() => getMagicPotWebUser() || null)
  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const avatarLetter = useMemo(() => {
    const source = username.trim() || user?.email || 'U'
    return source.slice(0, 1).toUpperCase()
  }, [user?.email, username])

  useEffect(() => {
    let cancelled = false
    const loadUser = async () => {
      try {
        const result = await accountFetch<{ user: MagicPotWebUser }>('/__magicpot/api/auth/me')
        if (cancelled) return
        setUser(result.user)
        setUsername(result.user.username)
        updateInjectedUser(result.user)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      }
    }

    void loadUser()
    return () => {
      cancelled = true
    }
  }, [])

  const saveAccount = async () => {
    if (!user) return
    const nextUsername = username.trim()
    if (!nextUsername) {
      setError('用户名不能为空')
      return
    }
    if ((password || confirmPassword) && password !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    if (password && password.length < 6) {
      setError('新密码至少需要 6 位')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (nextUsername !== user.username) {
        const result = await accountFetch<{ user: MagicPotWebUser }>('/__magicpot/api/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({ username: nextUsername })
        })
        setUser(result.user)
        updateInjectedUser(result.user)
      }
      if (password) {
        await accountFetch('/__magicpot/api/auth/me/password', {
          method: 'POST',
          body: JSON.stringify({ password })
        })
        setPassword('')
        setConfirmPassword('')
      }
      setMessage('账号信息已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const logout = async () => {
    setLoggingOut(true)
    setError(null)
    setMessage(null)
    try {
      await accountFetch('/__magicpot/api/auth/logout', { method: 'POST' })
      if (window.__MAGICPOT_WEB__) {
        window.__MAGICPOT_WEB__.user = undefined
      }
      window.location.assign('/login')
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : String(logoutError))
      setLoggingOut(false)
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
      <Paper
        sx={(theme) => ({
          minHeight: 'calc(100vh - 96px)',
          borderRadius: 3,
          p: 4,
          backgroundImage: 'none',
          bgcolor: theme.palette.mode === 'dark' ? '#18191d' : '#fff'
        })}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              您的账号
            </Typography>
            <Typography variant="body2" color="text.secondary">
              管理您的账号信息。
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5}>
            <Button
              startIcon={<LogoutIcon />}
              onClick={logout}
              disabled={saving || loggingOut}
              sx={(theme) => ({
                borderRadius: 2,
                px: 2.25,
                color: theme.palette.text.primary,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#f4f4f5',
                '&:hover': {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : '#ececef'
                }
              })}
            >
              登出
            </Button>
            <Button variant="contained" onClick={saveAccount} disabled={saving || loggingOut}>
              保存
            </Button>
          </Stack>
        </Stack>

        {(message || error) && (
          <Alert
            severity={error ? 'error' : 'success'}
            sx={{ mt: 3 }}
            onClose={() => {
              setMessage(null)
              setError(null)
            }}
          >
            {error || message}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mt: 4 }}>
          <Avatar
            sx={{
              width: 76,
              height: 76,
              bgcolor: '#f59e0b',
              fontSize: 34,
              fontWeight: 800
            }}
          >
            {avatarLetter}
          </Avatar>

          <Box sx={{ flex: 1, maxWidth: 680 }}>
            <Stack spacing={2.25}>
              <TextField label="注册邮箱" value={user?.email || ''} disabled fullWidth />
              <TextField
                label="用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                fullWidth
              />
              <TextField
                label="权限等级"
                value={user?.role === 'admin' ? '管理员' : '普通用户'}
                disabled
                fullWidth
              />
            </Stack>
          </Box>
        </Stack>

        <Divider sx={{ my: 4 }} />

        <Box sx={{ maxWidth: 680 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.75 }}>
            更改密码
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            设置新密码后，当前网页登录会继续保留。
          </Typography>
          <Stack spacing={2.25}>
            <TextField
              label="新密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              fullWidth
            />
            <TextField
              label="确认新密码"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              fullWidth
            />
          </Stack>
        </Box>
      </Paper>
    </Box>
  )
}

export default WebAccountPage
