/**
 * The document API, independent of any server framework.
 *
 * Vite's plugin mounts this as middleware during development; the packaged `serve` command
 * mounts the same function on a plain `node:http` server. One implementation means the tool
 * behaves identically whether you are developing it or have installed it.
 */

import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join, relative, resolve, sep } from 'node:path'
import { buildDocuments, type BuildResult } from '../parser/buildDocuments.js'
import { runScan } from '../scanner/runScan.js'

export interface Workspace {
  /** Project root; every path is resolved against it and none may escape it. */
  root: string
  /** Where Markdown documents live. */
  docsDir: string
  /** Where generated graphs are written. */
  outDir: string
  /** Where the document index is written. */
  manifest: string
  /** Where removed documents are moved. */
  trashDir: string
}

export function workspaceAt(root: string, outRoot = 'public'): Workspace {
  return {
    root: resolve(root),
    docsDir: resolve(root, 'docs'),
    outDir: resolve(root, outRoot, 'graphs'),
    manifest: resolve(root, outRoot, 'documents.json'),
    trashDir: resolve(root, 'docs/.trash'),
  }
}

export function reindex(workspace: Workspace): BuildResult {
  return buildDocuments({
    paths: [workspace.docsDir],
    outDir: workspace.outDir,
    manifest: workspace.manifest,
    cwd: workspace.root,
  })
}

/** Reject anything that would climb out of a directory. */
export function isInside(parent: string, target: string): boolean {
  const rel = relative(resolve(parent), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      try {
        resolvePromise(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch {
        rejectPromise(new Error('Body was not valid JSON'))
      }
    })
    request.on('error', () => rejectPromise(new Error('Could not read the request body')))
  })
}

export interface ApiOptions {
  workspace: Workspace
  /** Called after any change, so a dev server can push the new index to clients. */
  onChanged?: (result: BuildResult, changed?: string) => void
  log?: (message: string) => void
}

/**
 * Handle one `/__api/...` request. Returns false when the path is not ours, so the caller
 * can fall through to whatever else it serves.
 */
export function createApiHandler(options: ApiOptions) {
  const { workspace, onChanged, log } = options

  return async function handle(
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const send = (status: number, payload: unknown) => {
      response.statusCode = status
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(payload))
    }

    try {
      if (pathname === '/scan' && request.method === 'POST') {
        const body = await readBody(request)
        const paths = (Array.isArray(body.paths) ? body.paths : []).map(String).filter(Boolean)
        if (paths.length === 0) {
          send(400, { error: 'Give at least one project path.' })
          return true
        }
        for (const path of paths) {
          if (!existsSync(path) || !statSync(path).isDirectory()) {
            send(400, { error: `Not a directory: ${path}` })
            return true
          }
        }

        const result = runScan({
          roots: paths,
          title: typeof body.title === 'string' && body.title ? body.title : undefined,
          split: typeof body.split === 'boolean' ? body.split : undefined,
          minNodes: typeof body.minNodes === 'number' ? body.minNodes : undefined,
          docsDir: workspace.docsDir,
        })

        const index = reindex(workspace)
        onChanged?.(index)
        send(200, {
          documents: index.entries,
          splitApplied: result.splitApplied,
          title: result.title,
          filesScanned: result.report.filesScanned,
          nodesFound: result.draft.nodes.length,
          written: result.written.map((w) => ({
            ...w,
            path: relative(workspace.root, w.path).split(sep).join('/'),
          })),
        })
        return true
      }

      if (pathname === '/reindex' && request.method === 'POST') {
        const index = reindex(workspace)
        onChanged?.(index)
        send(200, { documents: index.entries, errors: index.errors, warnings: index.warnings })
        return true
      }

      if (pathname === '/remove' && request.method === 'POST') {
        const body = await readBody(request)
        const source = typeof body.source === 'string' ? body.source : ''
        if (!source) {
          send(400, { error: 'Which document? Send its source path.' })
          return true
        }
        const file = resolve(workspace.root, source)
        if (!isInside(workspace.root, file)) {
          send(400, { error: 'That path is outside the project.' })
          return true
        }
        if (!existsSync(file)) {
          send(404, { error: `Already gone: ${source}` })
          return true
        }

        mkdirSync(workspace.trashDir, { recursive: true })
        let target = join(workspace.trashDir, basename(file))
        for (let n = 2; existsSync(target); n++) {
          target = join(workspace.trashDir, `${basename(file, '.md')}-${n}.md`)
        }
        renameSync(file, target)

        const index = reindex(workspace)
        onChanged?.(index)
        send(200, {
          documents: index.entries,
          movedTo: relative(workspace.root, target).split(sep).join('/'),
        })
        return true
      }

      if (pathname === '/trash/empty' && request.method === 'POST') {
        if (existsSync(workspace.trashDir)) {
          rmSync(workspace.trashDir, { recursive: true, force: true })
        }
        send(200, { emptied: true })
        return true
      }

      send(404, { error: `Unknown endpoint: ${pathname}` })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log?.(`[api] ${message}`)
      send(500, { error: message })
      return true
    }
  }
}
