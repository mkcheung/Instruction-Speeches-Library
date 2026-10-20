import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

/** Separate loopback ports; never stops or reconfigures the development stack. */
export default mergeConfig(base, defineConfig({
  server: { host: '127.0.0.1', port: 5180, strictPort: true, hmr: false, allowedHosts: ['127.0.0.1'] },
}))
