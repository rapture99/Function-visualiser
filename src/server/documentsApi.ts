/**
 * The document API as a Vite plugin, for development.
 *
 * All the behaviour lives in `apiHandler.ts`, which the packaged `serve` command mounts on a
 * plain http server — so the tool behaves the same whether you are developing it or have
 * installed it. This file is the dev-only wiring: middleware, the docs watcher, and pushing
 * updates down the HMR socket.
 *
 * It is a plugin rather than a separate process because it must not exist in a build: the
 * built site is static files with no backend.
 */

import { basename, resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { createApiHandler, isInside, reindex, workspaceAt } from './apiHandler.js'

export function documentsApi(): Plugin {
  return {
    name: 'flow-visualizer:documents-api',
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      const workspace = workspaceAt(server.config.root)

      const push = (documents: unknown, changed?: string) => {
        server.ws.send({
          type: 'custom',
          event: 'flow-visualizer:documents',
          data: { documents, ...(changed ? { changed } : {}) },
        })
      }

      const handle = createApiHandler({
        workspace,
        onChanged: (result) => push(result.entries),
        log: (message) => server.config.logger.error(message),
      })

      server.middlewares.use('/__api', (request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0] ?? ''
        void handle(pathname, request, response).then((handled) => {
          if (!handled) next()
        })
      })

      // ---------------------------------------------------------------- live sync
      // Editing a document should update the map without a reload. Vite does not watch
      // `public/`, and regenerating graphs there would not reach the client anyway, so the
      // plugin watches `docs/` itself and pushes the new index. The client keeps its
      // selection, filters, playback position and camera — only the data swaps.
      server.watcher.add(workspace.docsDir)

      let pending: NodeJS.Timeout | undefined
      const onDocChange = (file: string) => {
        if (!file.endsWith('.md')) return
        if (!isInside(workspace.docsDir, file)) return
        // Editors save in bursts (write, rename, truncate); one rebuild per burst is enough.
        clearTimeout(pending)
        pending = setTimeout(() => {
          try {
            const index = reindex(workspace)
            push(index.entries, basename(file))
            server.config.logger.info(
              `[flow-visualizer] reindexed ${index.entries.length} document(s) after ${basename(file)}`,
            )
          } catch (error) {
            server.config.logger.error(
              `[flow-visualizer] reindex failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }, 120)
      }

      server.watcher.on('change', onDocChange)
      server.watcher.on('add', onDocChange)
      server.watcher.on('unlink', onDocChange)

      server.config.logger.info(
        `[flow-visualizer] documents API ready, watching ${resolve(workspace.docsDir)}`,
      )
    },
  }
}
