/**
 * Turn scan evidence into a draft functionality document.
 *
 * The output is explicitly a *draft*: a node catalogue with provenance attached, plus the
 * dependency edges that could be established from real HTTP calls. It contains no workflows,
 * and it never will — a workflow is a claim about intent, and the scanner has no access to
 * intent. Workflow templates are emitted as HTML comments (which the parser ignores) for a
 * human or an agent to fill in.
 */

import type { NodeKind } from '../schema/kinds.js'
import type { ConventionHit, Finding, ScanReport } from './scan.js'

export interface DraftNode {
  id: string
  kind: NodeKind
  name: string
  module: string
  meta: Record<string, string>
  dependencies: string[]
}

export interface Draft {
  title: string
  nodes: DraftNode[]
  openQuestions: string[]
  stats: {
    endpoints: number
    entities: number
    fromConventions: number
    linkedCalls: number
    unlinkedCalls: number
    computedCalls: number
  }
}

const ROLE_SUFFIX =
  /[._-](?:controller|controllers|route|routes|router|service|services|model|models|schema|schemas|job|jobs|worker|middleware|guard|repository|repo|handler|view|views|page|component|util|utils|helper|api|dao)$/i

const PASCAL_ROLE = /(Controller|Service|Repository|Model|Schema|Handler|Component|Page|View|Job|Worker|Middleware|Guard|Dao)$/

const GENERIC_STEMS = new Set([
  'index', 'main', 'app', 'application', 'routes', 'router', 'models', 'schema', 'config',
  'utils', 'util', 'helpers', 'constants', 'types', 'common', 'shared', 'core', 'base',
  'server', 'client', 'api', 'setup', 'init', '__init__', 'mod', 'lib',
  'src', 'source', 'internal', 'pkg', 'back', 'backend', 'front', 'frontend', 'web',
])

function titleCase(text: string): string {
  return text
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function slug(text: string): string {
  return (
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'node'
  )
}

/** Directories that hold things rather than being a thing — the feature is what follows. */
const CONTAINER_DIRS = new Set([
  'pages', 'page', 'views', 'screens', 'components', 'component', 'containers',
  'routes', 'route', 'controllers', 'controller', 'services', 'service',
  'models', 'model', 'modules', 'features', 'handlers', 'endpoints', 'domain', 'usecases',
])

/** Vendored UI kits. One bucket, not forty — nobody navigates by Accordion. */
const UI_KIT_DIRS = new Set(['ui', 'primitives', 'shadcn', 'atoms', 'design-system', 'ds', 'kit'])

/** Path prefixes that carry no feature meaning. */
const ROUTE_NOISE = new Set(['api', 'v1', 'v2', 'v3', 'rest', 'public', 'private'])

/**
 * Directory names to step over when looking for the feature after a container directory.
 * Deliberately much smaller than GENERIC_STEMS: `components/Common/` really is a feature
 * bucket worth keeping, even though "common" is a useless *filename*.
 */
const DIR_SKIP = new Set(['src', 'lib', 'app', 'core', 'base', 'internal', 'pkg', 'index'])

/**
 * The feature an endpoint belongs to, taken from its route.
 *
 * NOT used for grouping today, and the reason is worth recording: a scanner reads
 * `router.post("/login")` inside `auth.routes.js` and sees `/login`, because the `/auth`
 * prefix is applied by `app.use()` somewhere else entirely. Grouping on the declared path
 * therefore invents a feature per endpoint. The route file's name is the reliable signal.
 * Resolving mount prefixes would make this usable; until then it stays a helper.
 */
export function featureFromRoute(path: string): string | null {
  for (const segment of path.split('/').filter(Boolean)) {
    const lower = segment.toLowerCase()
    if (ROUTE_NOISE.has(lower)) continue
    if (segment.startsWith(':') || segment.startsWith('{') || segment.startsWith('<')) return null
    return titleCase(segment)
  }
  return null
}

/**
 * The feature a file belongs to.
 *
 * Layered backends put the feature in the filename (`auth.routes.js`); component trees put it
 * in the directory (`pages/Auth/Login.tsx`). Reading only the filename produced 118 modules
 * for 325 nodes on a real project, 111 of them holding a single node — every component became
 * its own "feature" because every component file has a unique name.
 *
 * So: find a directory that holds things, and take what follows it. That makes the backend's
 * `routes/auth.routes.js`, the client's `pages/Auth/Login.tsx` and its `services/authService.ts`
 * all land on "Auth", which is the grouping someone actually navigates by.
 */
export function featureOf(file: string): string {
  const parts = file.split('/')
  const fileName = parts.pop() ?? file

  for (let i = 0; i < parts.length; i++) {
    if (!CONTAINER_DIRS.has(parts[i]!.toLowerCase())) continue

    const next = parts[i + 1]
    if (!next) {
      // The container holds files directly, so the filename names the feature.
      return moduleOf(fileName)
    }
    const lower = next.toLowerCase()
    if (UI_KIT_DIRS.has(lower)) return 'UI kit'
    if (!DIR_SKIP.has(lower) && !CONTAINER_DIRS.has(lower)) return titleCase(next)
  }

  return moduleOf(file)
}

/**
 * Which feature a file belongs to, by filename alone.
 *
 * Uses the filename with its role suffix stripped, so `leaves.controller.js`,
 * `leaves.routes.js` and `LeaveService.ts` all land in the same module — features cut across
 * layer folders in every codebase, which is why grouping by directory alone gives you
 * "Controllers" and "Models" instead of anything useful. Falls back to the parent directory
 * when the filename is generic.
 */
export function moduleOf(file: string): string {
  const parts = file.split('/')
  const base = (parts.pop() ?? file).replace(/\.[^.]+$/, '')
  let stem = base.replace(ROLE_SUFFIX, '').replace(PASCAL_ROLE, '')
  if (!stem || GENERIC_STEMS.has(stem.toLowerCase())) {
    // Climb for the nearest directory that names something. When nothing does — `src/app/
    // main.py` — say so with a neutral bucket rather than pretending `src` is a feature.
    stem = [...parts].reverse().find((part) => !GENERIC_STEMS.has(part.toLowerCase())) ?? ''
  }
  return titleCase(stem) || 'Core'
}

class Ids {
  private used = new Set<string>()

  take(preferred: string): string {
    const base = slug(preferred)
    if (!this.used.has(base)) {
      this.used.add(base)
      return base
    }
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`
      if (!this.used.has(candidate)) {
        this.used.add(candidate)
        return candidate
      }
    }
  }
}

export function buildDraft(report: ScanReport, title: string): Draft {
  const ids = new Ids()
  const nodes: DraftNode[] = []
  const openQuestions: string[] = []

  // ---------------------------------------------------------------- declared endpoints
  const endpointByRoute = new Map<string, DraftNode>()
  const seenEndpoint = new Set<string>()

  for (const finding of report.findings) {
    if (!finding.route) continue
    const key = `${finding.route.method} ${finding.route.path}`
    if (seenEndpoint.has(key)) continue
    seenEndpoint.add(key)

    const node: DraftNode = {
      id: ids.take(`${finding.route.method}-${finding.route.path}`),
      kind: 'api',
      name: finding.name,
      module: featureOf(finding.file),
      meta: { ...finding.meta, Source: `${finding.file}:${finding.line}` },
      dependencies: [],
    }
    nodes.push(node)
    endpointByRoute.set(key, node)
  }

  // ---------------------------------------------------------------- declared entities
  const seenEntity = new Set<string>()
  for (const finding of report.findings) {
    if (finding.kind !== 'entity') continue
    const key = finding.name.toLowerCase()
    if (seenEntity.has(key)) continue
    seenEntity.add(key)
    nodes.push({
      id: ids.take(finding.name),
      kind: 'entity',
      name: finding.name,
      module: featureOf(finding.file),
      meta: { ...finding.meta, Source: `${finding.file}:${finding.line}` },
      dependencies: [],
    })
  }

  // ---------------------------------------------------------------- structural nodes
  const structural = new Map<string, ConventionHit>()
  for (const hit of report.conventions) {
    if (hit.kind === 'entity' && [...seenEntity].length > 0) continue // real models win
    structural.set(hit.file, hit)
  }

  const nodeByFile = new Map<string, DraftNode>()
  for (const [file, hit] of [...structural.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const base = (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '')
    const node: DraftNode = {
      id: ids.take(base),
      kind: hit.kind,
      name: titleCase(base),
      module: featureOf(file),
      meta: { Source: file, Found: hit.label },
      dependencies: [],
    }
    nodes.push(node)
    nodeByFile.set(file, node)
  }

  // ---------------------------------------------------------------- link calls to routes
  let linked = 0
  const unlinked = new Set<string>()
  const computed = new Set<string>()

  for (const finding of report.findings) {
    if (finding.unresolvedCall) {
      computed.add(`${finding.file}:${finding.line}`)
      continue
    }
    if (!finding.calls) continue
    const caller = nodeByFile.get(finding.file)
    const target = matchRoute(finding, endpointByRoute)

    if (!caller || !target) {
      unlinked.add(`${finding.calls.method ?? 'HTTP'} ${finding.calls.path} (${finding.file}:${finding.line})`)
      continue
    }
    if (caller.id === target.id || caller.dependencies.includes(target.id)) continue
    caller.dependencies.push(target.id)
    linked++
  }

  // ---------------------------------------------------------------- honesty section
  if (unlinked.size > 0) {
    openQuestions.push(
      `${unlinked.size} outbound HTTP call(s) could not be matched to a declared route — ` +
        'either the route lives in a service this scan did not reach, or the URL is built at ' +
        'runtime. Unmatched: ' +
        [...unlinked].slice(0, 8).join('; ') +
        (unlinked.size > 8 ? `; and ${unlinked.size - 8} more` : ''),
    )
  }
  if (computed.size > 0) {
    openQuestions.push(
      `${computed.size} HTTP call(s) build their URL from a variable, so which route they hit ` +
        'cannot be determined without following the data. These are invisible in the ' +
        'dependency edges below — trace them by hand. First few: ' +
        [...computed].slice(0, 6).join(', ') +
        (computed.size > 6 ? `, and ${computed.size - 6} more` : ''),
    )
  }
  openQuestions.push(
    'No workflows were generated. A workflow is a claim about intent and this document was ' +
      'produced by pattern-matching source files, so every flow below the node catalogue has ' +
      'to be traced by hand. Templates are commented out at the bottom of this file.',
  )
  openQuestions.push(
    'Node types were inferred from file location and naming conventions. Check them: a ' +
      'mis-typed node lands on the wrong layer, which is the one thing the layout takes as ' +
      'authoritative.',
  )
  if (report.truncated) {
    openQuestions.push(
      `The scan stopped at ${report.filesScanned} files. Point it at a subdirectory for full coverage.`,
    )
  }

  return {
    title,
    nodes,
    openQuestions,
    stats: {
      endpoints: endpointByRoute.size,
      entities: seenEntity.size,
      fromConventions: nodeByFile.size,
      linkedCalls: linked,
      unlinkedCalls: unlinked.size,
      computedCalls: computed.size,
    },
  }
}

/** Exact route match, then a suffix match to absorb base-path prefixes like `/api`. */
function matchRoute(
  finding: Finding,
  endpoints: Map<string, DraftNode>,
): DraftNode | undefined {
  const call = finding.calls
  if (!call) return undefined

  if (call.method) {
    const exact = endpoints.get(`${call.method} ${call.path}`)
    if (exact) return exact
  }

  for (const [key, node] of endpoints) {
    const [method, path] = key.split(' ')
    if (call.method && method !== call.method) continue
    if (!path) continue
    if (path === call.path || call.path.endsWith(path) || path.endsWith(call.path)) return node
  }
  return undefined
}

// ---------------------------------------------------------------------------- rendering

export function renderDraft(draft: Draft, report: ScanReport): string {
  const lines: string[] = [
    `# App: ${draft.title}`,
    '',
    'Scope: system',
    `Generated: scanner`,
    `Scanned: ${report.filesScanned} files`,
    '',
    '> **This is a draft.** It was produced by pattern-matching source files, so it is a node',
    '> catalogue with provenance — not a description of how anything works. Nothing here has',
    '> been verified by reading the code. Delete what is noise, fix the types, and write the',
    '> workflows by hand; the commented templates at the bottom are the starting point.',
    '',
  ]

  const byModule = new Map<string, DraftNode[]>()
  for (const node of draft.nodes) {
    const bucket = byModule.get(node.module)
    if (bucket) bucket.push(node)
    else byModule.set(node.module, [node])
  }

  for (const moduleName of [...byModule.keys()].sort()) {
    lines.push(`## Module: ${moduleName}`, '')
    for (const node of byModule.get(moduleName)!) {
      lines.push(`### Node: ${node.id}`)
      lines.push(`Type: ${TYPE_LABEL[node.kind] ?? node.kind}`)
      lines.push(`Name: ${node.name}`)
      for (const [key, value] of Object.entries(node.meta)) {
        if (!value) continue
        lines.push(`${key}: ${value}`)
      }
      if (node.dependencies.length > 0) {
        lines.push(`Dependencies: ${node.dependencies.join(', ')}`)
      }
      lines.push('')
    }
  }

  lines.push('## Open questions', '')
  for (const question of draft.openQuestions) lines.push(`- ${question}`)
  lines.push('')

  lines.push(
    '<!--',
    'Workflow templates. Uncomment one and fill in the steps by tracing the code.',
    'Every step must name a node id declared above.',
    '',
    '## Workflow: name-this-flow',
    'Name: A human-readable name',
    'Roles: User',
    '',
    'Steps:',
    ...draft.nodes.slice(0, 4).map((node, index) => `${index + 1}. ${node.id}`),
    '',
    'Errors:',
    '- at some-node-id: what goes wrong',
    '-->',
    '',
  )

  return lines.join('\n')
}

/** Canonical `Type:` values, so the emitted document uses the authoring vocabulary. */
const TYPE_LABEL: Partial<Record<NodeKind, string>> = {
  api: 'Endpoint',
  entity: 'Table',
  ui: 'Page',
  component: 'Component',
  controller: 'Controller',
  service: 'Service',
  job: 'Job',
  decision: 'Validation',
  function: 'Function',
  external: 'External',
  actor: 'Actor',
}

/**
 * Break one oversized draft into a document per feature.
 *
 * A 200-node catalogue is not reviewable — nobody deletes noise or writes workflows across
 * that surface, so it stays a draft forever. One document per feature is small enough to
 * actually finish, and the viewer's document picker gives them back as a set.
 *
 * The hard part is edges that cross a seam. A `Dependencies:` entry has to name a declared
 * node, so a document that references another feature's endpoint re-declares it, tagged with
 * `Feature:` naming where it really lives. That duplicates a line of metadata and keeps every
 * document independently valid and honest about its own boundary — which is the whole point
 * of splitting: the seams become visible instead of being buried in a hairball.
 */
export function splitByFeature(draft: Draft, minNodes = 3): Map<string, Draft> {
  const byFeature = new Map<string, DraftNode[]>()
  for (const node of draft.nodes) {
    const bucket = byFeature.get(node.module)
    if (bucket) bucket.push(node)
    else byFeature.set(node.module, [node])
  }

  // Features too small to be worth their own file are pooled, rather than producing a
  // directory of one-node documents.
  const small: DraftNode[] = []
  const kept = new Map<string, DraftNode[]>()
  for (const [feature, members] of byFeature) {
    if (members.length >= minNodes) kept.set(feature, members)
    else small.push(...members)
  }
  if (small.length > 0) kept.set('Other', small)

  const homeOf = new Map<string, string>()
  for (const [feature, members] of kept) {
    for (const node of members) homeOf.set(node.id, feature)
  }
  const byId = new Map(draft.nodes.map((node) => [node.id, node]))

  const out = new Map<string, Draft>()
  for (const [feature, members] of kept) {
    const own = new Set(members.map((node) => node.id))
    const imported: DraftNode[] = []

    for (const node of members) {
      for (const dependency of node.dependencies) {
        if (own.has(dependency) || imported.some((n) => n.id === dependency)) continue
        const target = byId.get(dependency)
        if (!target) continue
        imported.push({
          ...target,
          module: `${feature} boundary`,
          dependencies: [],
          meta: { ...target.meta, Feature: homeOf.get(dependency) ?? target.module },
        })
      }
    }

    out.set(feature, {
      title: `${draft.title} — ${feature}`,
      nodes: [...members, ...imported],
      stats: draft.stats,
      openQuestions: [
        `This document covers the ${feature} feature only, split out of a scan of the whole ` +
          'project. Nodes under "' + feature + ' boundary" belong to another feature and are ' +
          'declared here only so the connection to them survives.',
        ...draft.openQuestions,
      ],
    })
  }

  return out
}
