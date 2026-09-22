import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { documentsApi } from './src/server/documentsApi.js'

/**
 * Vite refuses requests whose Host header it does not recognise — a DNS-rebinding defence.
 * A tunnel serves the app under a hostname the dev server has never heard of, so without
 * these entries every ngrok URL answers "Blocked request. This host is not allowed."
 */
const TUNNEL_HOSTS = [
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.io',
  '.ngrok.app',
  '.trycloudflare.com',
  '.loca.lt',
]

export default defineConfig(({ command, mode }) => {
  /**
   * Over a tunnel the page arrives on 443 via TLS, but the HMR client would otherwise try to
   * open its websocket back to the local port and fail. Selected with `--mode tunnel` rather
   * than an env var, because `TUNNEL=1 vite` is not valid syntax in PowerShell — and applied
   * only in that mode, because these settings break plain localhost development.
   */
  const tunnelling = mode === 'tunnel'

  return {
    // Relative asset URLs in a build. Without this Vite emits `/assets/worker-x.js`, whose
    // leading slash discards the base — which breaks the layout worker inside a VS Code
    // webview, where the document lives under `vscode-webview://<id>/` and the real assets
    // sit somewhere else entirely. Dev keeps `/` so HMR paths are untouched.
    base: command === 'build' ? './' : '/',
    plugins: [react(), documentsApi()],
    // So the "Copy prompt" dialog can default the OUTPUT path to somewhere real on this
    // machine instead of asking the user to type an absolute path from memory.
    define: { __PROJECT_ROOT__: JSON.stringify(process.cwd()) },
    server: {
      port: 5173,
      host: tunnelling ? true : 'localhost',
      allowedHosts: TUNNEL_HOSTS,
      ...(tunnelling ? { hmr: { protocol: 'wss' as const, clientPort: 443 } } : {}),
    },
    preview: {
      port: 4173,
      allowedHosts: TUNNEL_HOSTS,
    },
    // The published package ships the viewer next to the compiled Node code, and the CLI's
    // `serve` command looks for it there. publicDir is NOT copied: in dev it holds this
    // checkout's own generated graphs, and shipping those would put sample data — and other
    // people's scanned projects — inside the tarball.
    build: { outDir: 'dist/web', emptyOutDir: true, copyPublicDir: false },
    // The generated graph.json files in public/ are served at the site root, which is how the
    // viewer loads them. Phase 6 replaces this with a watcher that regenerates them on save.
  }
})
