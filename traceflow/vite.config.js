import os from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Standard Vite + React. The API (server/index.ts) listens on 127.0.0.1 only; this server proxies
// /api to it. With LAN_ACCESS=true this server (not the API) also listens on the local network.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiHost = env.API_HOST || '127.0.0.1'
  const apiPort = env.API_PORT || '8787'
  const lan = String(env.LAN_ACCESS || 'false').toLowerCase() === 'true'
  const target = `http://${apiHost}:${apiPort}`
  const proxy = { '/api': { target, changeOrigin: false } }
  const name = os.hostname().toLowerCase()
  const host = lan ? true : 'localhost'
  const allowedHosts = lan ? [name, `${name}.local`] : undefined
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { host, port: Number(env.VITE_PORT || 5173), strictPort: true, proxy, allowedHosts },
    preview: { host, port: 4173, strictPort: true, proxy, allowedHosts },
  }
})
