/**
 * Deterministic synthetic document generator.
 *
 * The shipped sample document is 23 nodes — far too small to say anything useful about
 * layout quality, layer density or performance. This produces realistically shaped
 * documents at any size: logic-heavy (7 of every 12 declared nodes land in the `logic`
 * layer, matching what real applications produce), modules that cross-reference each
 * other, workflows that share backend nodes, a role handover, and error paths.
 *
 * Contains no randomness at all — output is a pure function of the options, so scale
 * fixtures are reproducible without a seed to remember.
 */

export interface SynthOptions {
  /** Feature modules to generate. Each contributes 12 declared nodes and 2 workflows. */
  modules: number
  /** Cross-module `Dependencies:` edges, forming a ring. Ignored when modules < 2. */
  crossModuleDeps?: boolean
  /** Error paths per workflow. */
  errorPaths?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Per-module node template. The kind mix is deliberate, not arbitrary: it reproduces the
 * ~3:7:2 interface/logic/data split seen in real documents, which is the density problem
 * the layout engine has to solve.
 */
const TEMPLATE: ReadonlyArray<{ suffix: string; type: string; name: string; extra?: string[] }> = [
  { suffix: 'page', type: 'Page', name: '{M} list screen', extra: ['Component: src/pages/{s}/List.tsx'] },
  { suffix: 'form', type: 'Component', name: '{M}Form', extra: ['Component: src/components/{s}/Form.tsx'] },
  { suffix: 'detail', type: 'Page', name: '{M} detail screen' },
  { suffix: 'get', type: 'Endpoint', name: 'GET /api/{s}', extra: ['Method: GET', 'Path: /api/{s}'] },
  { suffix: 'post', type: 'Endpoint', name: 'POST /api/{s}', extra: ['Method: POST', 'Path: /api/{s}'] },
  { suffix: 'controller', type: 'Controller', name: '{M}Controller' },
  { suffix: 'check', type: 'Validation', name: '{M} payload valid?' },
  { suffix: 'service', type: 'Service', name: '{M}Service' },
  { suffix: 'notify', type: 'Service', name: '{M}NotificationService' },
  { suffix: 'job', type: 'Job', name: '{M}ReindexJob' },
  { suffix: 'record', type: 'Table', name: '{s}_records' },
  { suffix: 'index', type: 'Table', name: '{s}_index' },
]

function expand(text: string, moduleName: string, slug: string): string {
  return text.split('{M}').join(moduleName).split('{s}').join(slug)
}

export function synthDocument(opts: SynthOptions): string {
  const { modules, crossModuleDeps = true, errorPaths = true } = opts
  if (modules < 1) throw new Error('synthDocument requires at least one module')

  const lines: string[] = [
    '# App: Synthetic scale fixture',
    '',
    'Scope: system',
    'Generator: src/testing/synth.ts',
    `Modules: ${modules}`,
    '',
    '## Module: Access',
    '',
    '### Node: user',
    'Type: Actor',
    'Name: User',
    '',
    '### Node: admin',
    'Type: Actor',
    'Name: Administrator',
    '',
  ]

  for (let i = 1; i <= modules; i++) {
    const moduleName = `Feature ${pad(i)}`
    const slug = `f${pad(i)}`
    lines.push(`## Module: ${moduleName}`, '')

    for (const spec of TEMPLATE) {
      lines.push(`### Node: ${slug}-${spec.suffix}`)
      lines.push(`Type: ${spec.type}`)
      lines.push(`Name: ${expand(spec.name, moduleName, slug)}`)
      for (const extra of spec.extra ?? []) lines.push(expand(extra, moduleName, slug))
      // Ring dependency: each module's service depends on the next module's service, which
      // guarantees cross-module edges — the thing that makes module placement actually matter.
      if (spec.suffix === 'service' && crossModuleDeps && modules > 1) {
        const next = (i % modules) + 1
        lines.push(`Dependencies: f${pad(next)}-service`)
      }
      lines.push('')
    }
  }

  for (let i = 1; i <= modules; i++) {
    const moduleName = `Feature ${pad(i)}`
    const slug = `f${pad(i)}`

    // Create path: exercises a role handover partway through, like a real approval flow.
    lines.push(`## Workflow: ${slug}-create`, '')
    lines.push(`Name: Create a ${moduleName} record`)
    lines.push('Roles: User')
    lines.push('')
    lines.push('Steps:')
    lines.push(...numbered([
      'user',
      `${slug}-page`,
      `${slug}-form`,
      `${slug}-post`,
      `${slug}-controller`,
      `${slug}-check`,
      `${slug}-service`,
      `${slug}-record (write)`,
      `${slug}-notify`,
      'admin (role: Admin)',
      `${slug}-job`,
      `${slug}-index (write)`,
    ]))
    if (errorPaths) {
      lines.push('', 'Errors:')
      lines.push(`- at ${slug}-check: payload rejected in ${moduleName}`)
      lines.push(`- at ${slug}-service -> ${slug}-conflict: concurrent update in ${moduleName}`)
    }
    lines.push('')

    // Read path: reuses the same backend nodes, so nodes belong to multiple workflows.
    lines.push(`## Workflow: ${slug}-read`, '')
    lines.push(`Name: Browse ${moduleName}`)
    lines.push('Roles: User')
    lines.push('')
    lines.push('Steps:')
    lines.push(...numbered([
      'user',
      `${slug}-detail`,
      `${slug}-get`,
      `${slug}-controller`,
      `${slug}-service`,
      `${slug}-index (read)`,
      `${slug}-record (read)`,
    ]))
    lines.push('')
  }

  return lines.join('\n')
}

function numbered(steps: string[]): string[] {
  return steps.map((step, i) => `${i + 1}. ${step}`)
}

/** Modules needed to land near a target declared-node count (12 declared nodes per module). */
export function modulesForNodeCount(target: number): number {
  return Math.max(1, Math.round((target - 2) / 12))
}
