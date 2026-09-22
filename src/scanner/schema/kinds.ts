/**
 * Node/edge vocabulary.
 *
 * Deliberately scope-agnostic: the same five layers have to make sense whether the
 * document describes a whole application, one feature, or a single function.
 *
 *   layer        system scope          feature scope        function scope
 *   ---------------------------------------------------------------------------
 *   actor        user roles            user roles           caller
 *   interface    pages / screens       components           inputs / outputs
 *   logic        controllers/services  handlers / hooks     the function, branches
 *   data         tables / entities     stores               state, closures
 *   external     3rd-party systems     3rd-party systems    3rd-party systems
 */

export const LAYERS = ['actor', 'interface', 'logic', 'data', 'external'] as const
export type Layer = (typeof LAYERS)[number]

export const NODE_KINDS = [
  // who
  'actor',
  // interface
  'ui',
  'component',
  'input',
  'output',
  // logic
  'api',
  'event',
  'controller',
  'service',
  'function',
  'job',
  'decision',
  // data
  'entity',
  'store',
  'state',
  // boundaries and failure
  'external',
  'error',
  // grouping
  'module',
  // machine-generated, never authored
  'unknown',
  'unresolved',
] as const
export type NodeKind = (typeof NODE_KINDS)[number]

export const EDGE_KINDS = [
  'next',
  'calls',
  'renders',
  'reads',
  'writes',
  'emits',
  'returns',
  'depends',
  'contains',
  'error',
] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

/**
 * Layer is DERIVED from kind, never authored. If authors could place a service in the
 * interface layer the spatial layout would stop meaning anything, which is the whole
 * point of having layers.
 */
export const KIND_LAYER: Record<NodeKind, Layer> = {
  actor: 'actor',
  ui: 'interface',
  component: 'interface',
  input: 'interface',
  output: 'interface',
  api: 'logic',
  event: 'logic',
  controller: 'logic',
  service: 'logic',
  function: 'logic',
  job: 'logic',
  decision: 'logic',
  entity: 'data',
  store: 'data',
  state: 'data',
  external: 'external',
  error: 'logic', // overridden at resolve time to match the node the error branches from
  module: 'logic', // overridden at resolve time to the majority layer of its members
  unknown: 'logic',
  unresolved: 'logic',
}

/**
 * Authoring aliases. People write `Type: Database`, not `Type: entity`. Accepting
 * synonyms costs nothing and removes the most common source of parse failures.
 */
const ALIASES: Record<string, NodeKind> = {
  // actor
  actor: 'actor', role: 'actor', user: 'actor', persona: 'actor', system: 'actor',
  // interface
  ui: 'ui', page: 'ui', screen: 'ui', view: 'ui', form: 'ui',
  component: 'component', widget: 'component', element: 'component',
  input: 'input', param: 'input', parameter: 'input', arg: 'input', argument: 'input', payload: 'input',
  output: 'output', return: 'output', returns: 'output', result: 'output', response: 'output',
  // logic
  api: 'api', endpoint: 'api', route: 'api', request: 'api',
  event: 'event', message: 'event', topic: 'event', emit: 'event', webhook: 'event',
  controller: 'controller', handler: 'controller',
  service: 'service', svc: 'service', usecase: 'service', 'use-case': 'service',
  function: 'function', fn: 'function', func: 'function', method: 'function', hook: 'function', util: 'function',
  job: 'job', worker: 'job', queue: 'job', cron: 'job', task: 'job', scheduler: 'job',
  decision: 'decision', branch: 'decision', condition: 'decision', if: 'decision',
  approval: 'decision', gate: 'decision', check: 'decision', validation: 'decision',
  // data
  entity: 'entity', database: 'entity', db: 'entity', table: 'entity', model: 'entity',
  collection: 'entity', record: 'entity',
  store: 'store', cache: 'store', redis: 'store', storage: 'store', bucket: 'store',
  state: 'state', context: 'state', session: 'state', variable: 'state',
  // boundary / failure
  external: 'external', 'third-party': 'external', thirdparty: 'external',
  integration: 'external', vendor: 'external',
  error: 'error', failure: 'error', exception: 'error', fault: 'error',
  // grouping
  module: 'module', feature: 'module', domain: 'module', group: 'module',
}

/** Resolve an authored `Type:` string to a canonical kind. Returns null if unrecognised. */
export function resolveKind(raw: string): NodeKind | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '-')
  return ALIASES[key] ?? null
}

/** Kinds an author may legitimately write. Used to build the "did you mean" hint. */
export const AUTHORABLE_TYPES = Object.keys(ALIASES).sort()

/**
 * Default edge kind for a workflow step, based on what the step points at.
 * `null` means "genuinely ambiguous" — the caller must warn rather than guess.
 */
export function defaultEdgeKind(targetKind: NodeKind): EdgeKind | null {
  switch (targetKind) {
    case 'api':
      return 'calls'
    case 'ui':
    case 'component':
      return 'renders'
    case 'event':
      return 'emits'
    case 'output':
      return 'returns'
    case 'controller':
    case 'service':
    case 'function':
    case 'job':
      return 'calls'
    case 'entity':
    case 'store':
    case 'state':
      // read or write? The document has to say. Never assume.
      return null
    default:
      return 'next'
  }
}
