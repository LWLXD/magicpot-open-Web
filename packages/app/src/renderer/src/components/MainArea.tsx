// packages/app/src/renderer/src/components/MainArea.tsx
import React, { Suspense } from 'react'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { routes } from '../routes'
import { canAccessWebAdminSurface, isMagicPotWebRuntime } from '../utils/webRuntime'

const WEB_ADMIN_ONLY_PATHS = new Set([
  '/settings',
  '/qappdesign',
  '/workshop',
  '/target-manager',
  '/custom-skill-manager',
  '/web-admin'
])

const WebPermissionDenied: React.FC = () => {
  const navigate = useNavigate()
  return (
    <Box
      sx={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        minHeight: 0,
        p: 3
      }}
    >
      <Box sx={{ textAlign: 'center', maxWidth: 420 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
          当前账号无权访问
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          普通用户无法进入设置页面和自定义工坊，请联系管理员调整权限。
        </Typography>
        <Button variant="contained" onClick={() => navigate('/')}>
          返回工作台
        </Button>
      </Box>
    </Box>
  )
}

const MainArea: React.FC = () => {
  const location = useLocation()
  const canAccessAdminSurface = canAccessWebAdminSurface()

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0
      }}
    >
      {/* 内容区 */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: 'background.default',
          minHeight: 0
        }}
      >
        <Routes>
          {routes.map((route) => (
            <Route
              key={route.id}
              path={route.path}
              element={
                isMagicPotWebRuntime() &&
                WEB_ADMIN_ONLY_PATHS.has(route.path) &&
                !canAccessAdminSurface ? (
                  <WebPermissionDenied />
                ) : (
                  <Suspense
                    fallback={
                      <Box
                        sx={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minHeight: 0
                        }}
                      >
                        <CircularProgress size={28} />
                      </Box>
                    }
                  >
                    <route.Page key={location.pathname + location.search} />
                  </Suspense>
                )
              }
            />
          ))}
        </Routes>
      </Box>
    </Box>
  )
}

export default MainArea
