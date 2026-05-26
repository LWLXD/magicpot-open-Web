import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './config'

describe('web server config', () => {
  it('enables the MagicPot Web server by default for LAN access', () => {
    expect(DEFAULT_CONFIG.web_server_config).toMatchObject({
      enable_server: true,
      host: '0.0.0.0',
      port: 3218,
      allow_registration: true
    })
  })
})
