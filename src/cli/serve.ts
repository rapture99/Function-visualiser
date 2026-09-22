/**
 * Serving the built viewer from an installed package.
 *
 * A plain `node:http` server with no dependencies: it hands out the bundled web assets, the
 * generated graphs, and the same `/__api` endpoints the dev server exposes — so an installed
 * copy can add, reindex and remove documents exactly like a checkout can.
 *
 * Live sync uses polling rather than a websocket. The dev server already has an HMR socket to
 * ride on; standing one up here would mean a dependency and a protocol for a feature whose
 * whole job is noticing a file changed, so the client asks instead.
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { createApiHandler, reindex, workspaceAt, type Workspace } from '../server/apiHandler.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export interface ServeOptions {
  root: string
  /** Directory holding the built viewer (index.html + assets). */
  webRoot: string
  outRoot: string
  port: number
  host: string
}

export async function serve(options: ServeOptions): Promise<{ port: number; close: () => void }> {
  const workspace: Workspace = workspaceAt(options.root, options.outRoot)
  const handleApi = createApiHandler({
    workspace,
    log: (message) => console.error(message),
  })

  // Index once at startup so the viewer has something to show immediately.
  try {
    const index = reindex(workspace)
    console.error(`indexed ${index.entries.length} document(s) from ${workspace.docsDir}`)
  } catch (error) {
    console.error(`could not index ${workspace.docsDir}: ${String(error)}`)
  }

  const serveFile = (file: string, response: import('node:http').ServerResponse) => {
    response.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
    // Generated graphs change under a running server; never let a proxy hold them.
    response.setHeader('cache-control', 'no-cache')
    createReadStream(file).pipe(response)
  }

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')

    if (pathname.startsWith('/__api')) {
      void handleApi(pathname.slice('/__api'.length), request, response)
      return
    }

    // The manifest and graphs come from the workspace, everything else from the bundle.
    const fromOut =
      pathname === '/documents.json'
        ? resolve(workspace.root, options.outRoot, 'documents.json')
        : pathname.startsWith('/graphs/')
          ? resolve(workspace.root, options.outRoot, pathname.slice(1))
          : null

    if (fromOut) {
      if (!existsSync(fromOut)) {
        response.statusCode = 404
        response.end('{"documents":[]}')
        return
      }
      serveFile(fromOut, response)
      return
    }

    const target = join(options.webRoot, pathname === '/' ? 'index.html' : pathname.slice(1))
    if (existsSync(target) && statSync(target).isFile()) {
      serveFile(target, response)
      return
    }

    // Single-page app: unknown paths get the shell.
    const shell = join(options.webRoot, 'index.html')
    if (existsSync(shell)) {
      serveFile(shell, response)
      return
    }

    response.statusCode = 404
    response.end('Not found')
  })

  return new Promise((resolvePromise, reject) => {
    server.on('error', reject)
    server.listen(options.port, options.host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      resolvePromise({ port, close: () => server.close() })
    })
  })
}
