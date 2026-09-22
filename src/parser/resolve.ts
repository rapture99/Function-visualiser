/**
 * Stage 3: raw IR -> validated graph.
 *
 * This is where the core rule lives: **nodes are declared once, workflows only reference
 * them.** A step that names an unknown id does not quietly create a node — it produces an
 * `unresolved` ghost (so the picture stays honest and visibly broken) plus an error
 * diagnostic pointing at the line. The same applies to ambiguity: a step touching a data
 * node without saying read or write is warned about, never guessed at.
 */

import {
  KIND_LAYER,
  LAYERS,
  AUTHORABLE_TYPES,
  defaultEdgeKind,
  resolveKind,
  type EdgeKind,
  type Layer,
  type NodeKind,
} from '../schema/kinds.js'
import {
  SCHEMA_VERSION,
  SCOPES,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Scope,
  type Workflow,
  type WorkflowError,
  type WorkflowStep,
} from '../schema/graph.js'
import { CODES, suggest, type DiagnosticBag } from './diagnostics.js'
import type { RawDoc, RawNode, RawWorkflow, Prop } from './extract.js'

const RE_ID = /^[a-z0-9][a-z0-9._/-]*$/

const RESERVED_NODE_KEYS = new Set([
  'type', 'name', 'description', 'role', 'roles',
  'dependencies', 'depends', 'depends on', 'module',
])
const RESERVED_WORKFLOW_KEYS = new Set([
  'name', 'description', 'role', 'roles', 'steps', 'flow', 'sequence',
  'errors', 'error paths', 'error-paths', 'failures', 'failure paths',
])

const EDGE_KIND_ANNOTATIONS: Record<string, EdgeKind> = {
  read: 'reads', reads: 'reads',
  write: 'writes', writes: 'writes',
  call: 'calls', calls: 'calls',
  render: 'renders', renders: 'renders',
  emit: 'emits', emits: 'emits',
  return: 'returns', returns: 'returns',
  next: 'next',
}

export function normalizeId(raw: string): string {
  return raw.trim().toLowerCase()
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function humanize(id: string): string {
  return id
    .split(/[-_./]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

/** Case-insensitive prop lookup across a set of candidate keys. */
function prop(props: Map<string, Prop>, ...keys: string[]): Prop | undefined {
  for (const [k, v] of props) {
    if (keys.includes(k.toLowerCase())) return v
  }
  return undefined
}

interface Builder {
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
  edgeIds: Set<string>
}

function addEdge(b: Builder, edge: GraphEdge): GraphEdge | null {
  if (b.edgeIds.has(edge.id)) return null
  b.edgeIds.add(edge.id)
  b.edges.push(edge)
  return edge
}

export function resolve(doc: RawDoc, file: string, diag: DiagnosticBag): Graph {
  const b: Builder = { nodes: new Map(), edges: [], edgeIds: new Set() }

  // ---------------------------------------------------------------- declared nodes
  for (const raw of doc.nodes) {
    const node = buildNode(raw, file, diag)
    if (!node) continue
    if (b.nodes.has(node.id)) {
      diag.error(
        CODES.DUPLICATE_NODE,
        raw.line,
        `Node "${node.id}" is already declared at line ${b.nodes.get(node.id)!.source.line}.`,
        'Node ids must be unique across the whole document.',
      )
      continue
    }
    b.nodes.set(node.id, node)
  }

  // ---------------------------------------------------------------- module containers
  for (const [moduleName, line] of doc.modules) {
    const id = `module/${slug(moduleName)}`
    const members = [...b.nodes.values()].filter((n) => n.module === moduleName)
    if (members.length === 0) continue

    b.nodes.set(id, {
      id,
      kind: 'module',
      layer: majorityLayer(members),
      name: moduleName,
      roles: [],
      meta: {},
      workflows: [],
      rolesReached: [],
      implicit: true,
      source: { file, line },
    })

    for (const member of members) {
      member.parentId = id
      addEdge(b, {
        id: `${id}->${member.id}:contains`,
        from: id,
        to: member.id,
        kind: 'contains',
        source: member.source,
      })
    }
  }

  // ---------------------------------------------------------------- declared dependencies
  for (const raw of doc.nodes) {
    const id = normalizeId(raw.id)
    const from = b.nodes.get(id)
    if (!from) continue
    const deps = prop(raw.props, 'dependencies', 'depends', 'depends on')
    if (!deps) continue

    for (const ref of splitList(deps.value)) {
      const to = reference(b, ref, deps.line, file, diag, CODES.UNKNOWN_DEPENDENCY)
      if (to === from.id) {
        diag.warn(CODES.SELF_LOOP, deps.line, `"${from.id}" lists itself as a dependency.`)
        continue
      }
      addEdge(b, {
        id: `${from.id}->${to}:depends`,
        from: from.id,
        to,
        kind: 'depends',
        source: { file, line: deps.line },
      })
    }
  }

  // ---------------------------------------------------------------- workflows
  const workflows: Workflow[] = []
  const seenWorkflows = new Set<string>()

  for (const raw of doc.workflows) {
    const wf = buildWorkflow(raw, b, file, diag)
    if (!wf) continue
    if (seenWorkflows.has(wf.id)) {
      diag.error(CODES.DUPLICATE_WORKFLOW, raw.line, `Workflow "${wf.id}" is declared twice.`)
      continue
    }
    seenWorkflows.add(wf.id)
    workflows.push(wf)
  }

  // ---------------------------------------------------------------- derived fields
  for (const wf of workflows) {
    const touch = (nodeId: string, role?: string) => {
      const node = b.nodes.get(nodeId)
      if (!node) return
      if (!node.workflows.includes(wf.id)) node.workflows.push(wf.id)
      if (role && !node.rolesReached.includes(role)) node.rolesReached.push(role)
      // Roles propagate up to the containing module so module-level filtering works.
      if (node.parentId) touch(node.parentId, role)
    }
    for (const step of wf.steps) touch(step.nodeId, step.role)
    for (const err of wf.errors) touch(err.errorNodeId, undefined)
  }

  // ---------------------------------------------------------------- graph health
  const degree = new Map<string, number>()
  for (const e of b.edges) {
    if (e.kind === 'contains') continue
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  for (const node of b.nodes.values()) {
    if (node.kind === 'module' || node.implicit) continue
    if ((degree.get(node.id) ?? 0) === 0) {
      diag.warn(
        CODES.ORPHAN_NODE,
        node.source.line,
        `"${node.id}" is declared but no workflow or dependency references it.`,
        'Reference it from a workflow step, or delete the declaration.',
      )
    }
  }

  if (b.nodes.size === 0) {
    diag.error(
      CODES.NO_CONTENT,
      0,
      'No nodes were found in this document.',
      'Declare nodes with `### Node: <id>` followed by a `Type:` line.',
    )
  }

  // ---------------------------------------------------------------- document meta
  const scopeProp = prop(doc.meta, 'scope')
  let scope: Scope = 'unspecified'
  if (scopeProp) {
    const candidate = scopeProp.value.trim().toLowerCase() as Scope
    if ((SCOPES as readonly string[]).includes(candidate)) scope = candidate
    else
      diag.warn(
        CODES.UNKNOWN_TYPE,
        scopeProp.line,
        `Unknown scope "${scopeProp.value}".`,
        `Expected one of: ${SCOPES.join(', ')}.`,
      )
  }

  const extra: Record<string, string> = {}
  for (const [k, v] of doc.meta) {
    if (k.toLowerCase() === 'scope') continue
    extra[k] = v.value
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...(doc.title ? { title: doc.title } : {}),
      scope,
      source: file,
      extra,
    },
    nodes: [...b.nodes.values()],
    edges: b.edges,
    workflows,
    diagnostics: diag.items,
  }
}

// -------------------------------------------------------------------------------- nodes

function buildNode(raw: RawNode, file: string, diag: DiagnosticBag): GraphNode | null {
  const id = normalizeId(raw.id)
  if (!RE_ID.test(id)) {
    diag.error(
      CODES.INVALID_ID,
      raw.line,
      `"${raw.id}" is not a valid node id.`,
      'Use lowercase letters, digits, and - . _ / — for example `apply-leave-page`.',
    )
    return null
  }

  const typeProp = prop(raw.props, 'type')
  let kind: NodeKind = 'unknown'
  if (!typeProp || !typeProp.value) {
    diag.error(
      CODES.MISSING_TYPE,
      raw.line,
      `Node "${id}" has no \`Type:\` line.`,
      `Add one, e.g. \`Type: Service\`. Known types: ${AUTHORABLE_TYPES.slice(0, 8).join(', ')}, …`,
    )
  } else {
    const resolved = resolveKind(typeProp.value)
    if (resolved) kind = resolved
    else {
      const hint = suggest(typeProp.value, AUTHORABLE_TYPES)
      diag.error(
        CODES.UNKNOWN_TYPE,
        typeProp.line,
        `Unknown type "${typeProp.value}" on node "${id}".`,
        hint ? `Did you mean "${hint}"?` : `Known types include: ${AUTHORABLE_TYPES.slice(0, 10).join(', ')}.`,
      )
    }
  }

  const nameProp = prop(raw.props, 'name')
  const descProp = prop(raw.props, 'description')
  const rolesProp = prop(raw.props, 'roles', 'role')

  const meta: Record<string, string> = {}
  for (const [key, value] of raw.props) {
    if (RESERVED_NODE_KEYS.has(key.toLowerCase())) continue
    meta[key] = value.value
  }

  return {
    id,
    kind,
    layer: KIND_LAYER[kind],
    name: nameProp?.value || humanize(id),
    ...(descProp?.value || raw.prose.length
      ? { description: descProp?.value || raw.prose.join(' ') }
      : {}),
    ...(raw.module ? { module: raw.module } : {}),
    roles: rolesProp ? splitList(rolesProp.value) : [],
    meta,
    workflows: [],
    rolesReached: [],
    implicit: false,
    source: { file, line: raw.line },
  }
}

/**
 * Ties are broken by the fixed LAYERS order, never by Map insertion order — otherwise
 * merely reordering two declarations in the document could flip a module's layer, which
 * would move it in the eventual layout for no semantic reason at all.
 */
function majorityLayer(nodes: GraphNode[]): Layer {
  const counts = new Map<Layer, number>()
  for (const n of nodes) counts.set(n.layer, (counts.get(n.layer) ?? 0) + 1)
  let best: Layer = 'logic'
  let bestCount = -1
  for (const layer of LAYERS) {
    const count = counts.get(layer) ?? 0
    if (count > bestCount) {
      best = layer
      bestCount = count
    }
  }
  return best
}

/**
 * Look up a referenced id. Unknown ids become visible `unresolved` ghosts rather than
 * being dropped — a broken document should look broken, not look smaller.
 */
function reference(
  b: Builder,
  rawRef: string,
  line: number,
  file: string,
  diag: DiagnosticBag,
  code: string,
): string {
  const id = normalizeId(rawRef)
  if (b.nodes.has(id)) return id

  const hint = suggest(id, [...b.nodes.keys()].filter((k) => !k.startsWith('module/')))
  diag.error(
    code,
    line,
    `Reference to undeclared node "${rawRef}".`,
    hint
      ? `Did you mean "${hint}"?`
      : 'Declare it first with `### Node: ' + id + '` and a `Type:` line.',
  )

  if (!b.nodes.has(id)) {
    b.nodes.set(id, {
      id,
      kind: 'unresolved',
      layer: KIND_LAYER.unresolved,
      name: rawRef,
      roles: [],
      meta: {},
      workflows: [],
      rolesReached: [],
      implicit: true,
      source: { file, line },
    })
  }
  return id
}

// ---------------------------------------------------------------------------- workflows

interface StepAnnotations {
  edgeKind?: EdgeKind
  role?: string
  condition?: string
  label?: string
}

function parseAnnotations(
  annotations: string[],
  line: number,
  diag: DiagnosticBag,
): StepAnnotations {
  const out: StepAnnotations = {}
  for (const annotation of annotations) {
    const colon = annotation.indexOf(':')
    if (colon > 0) {
      const key = annotation.slice(0, colon).trim().toLowerCase()
      const value = annotation.slice(colon + 1).trim()
      if (key === 'role' || key === 'as') out.role = value
      else if (key === 'when' || key === 'if' || key === 'condition') out.condition = value
      else if (key === 'label') out.label = value
      else
        diag.warn(
          CODES.UNKNOWN_ANNOTATION,
          line,
          `Unknown step annotation "${key}".`,
          'Supported: role:, when:, label:, and the bare words read, write, calls, renders, emits, returns.',
        )
      continue
    }

    const edgeKind = EDGE_KIND_ANNOTATIONS[annotation.toLowerCase()]
    if (edgeKind) out.edgeKind = edgeKind
    else {
      const hint = suggest(annotation, Object.keys(EDGE_KIND_ANNOTATIONS))
      diag.warn(
        CODES.UNKNOWN_ANNOTATION,
        line,
        `Unknown step annotation "${annotation}".`,
        hint ? `Did you mean "${hint}"?` : undefined,
      )
    }
  }
  return out
}

function buildWorkflow(
  raw: RawWorkflow,
  b: Builder,
  file: string,
  diag: DiagnosticBag,
): Workflow | null {
  const id = normalizeId(raw.id)
  if (!RE_ID.test(id)) {
    diag.error(CODES.INVALID_ID, raw.line, `"${raw.id}" is not a valid workflow id.`)
    return null
  }

  const nameProp = prop(raw.props, 'name')
  const descProp = prop(raw.props, 'description')
  const rolesProp = prop(raw.props, 'roles', 'role')
  const roles = rolesProp ? splitList(rolesProp.value) : []

  const meta: Record<string, string> = {}
  for (const [key, value] of raw.props) {
    if (RESERVED_WORKFLOW_KEYS.has(key.toLowerCase())) continue
    meta[key] = value.value
  }

  if (raw.steps.length === 0) {
    diag.warn(
      CODES.EMPTY_WORKFLOW,
      raw.line,
      `Workflow "${id}" has no steps.`,
      'Add a `Steps:` block with a numbered list of node ids.',
    )
  }

  // Resolve every step first, then wire edges between consecutive pairs.
  const steps: WorkflowStep[] = []
  let currentRole: string | undefined = roles[0]

  for (let i = 0; i < raw.steps.length; i++) {
    const rawStep = raw.steps[i]!
    const nodeId = reference(b, rawStep.ref, rawStep.line, file, diag, CODES.UNKNOWN_NODE_REF)
    const annotations = parseAnnotations(rawStep.annotations, rawStep.line, diag)
    // A `role:` annotation switches the acting role from this step onward — that is what
    // makes "the same workflow, different roles" (employee submits, admin approves) work.
    if (annotations.role) currentRole = annotations.role

    steps.push({
      order: i + 1,
      nodeId,
      ...(rawStep.note ? { note: rawStep.note } : {}),
      ...(currentRole ? { role: currentRole } : {}),
      source: { file, line: rawStep.line },
    })
    ;(steps[i] as WorkflowStep & { _ann?: StepAnnotations })._ann = annotations
  }

  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i]!
    const to = steps[i + 1]!
    const annotations = (to as WorkflowStep & { _ann?: StepAnnotations })._ann ?? {}

    if (from.nodeId === to.nodeId) {
      diag.warn(
        CODES.REPEATED_STEP,
        to.source.line,
        `Step ${to.order} repeats "${to.nodeId}"; no edge was created.`,
      )
      continue
    }

    const target = b.nodes.get(to.nodeId)!
    let kind = annotations.edgeKind
    if (!kind) {
      const fallback = defaultEdgeKind(target.kind)
      if (fallback) {
        kind = fallback
      } else {
        // Data access with no read/write annotation: flag it, do not guess silently.
        kind = 'reads'
        diag.warn(
          CODES.AMBIGUOUS_DATA_ACCESS,
          to.source.line,
          `Step ${to.order} touches "${to.nodeId}" but does not say whether it reads or writes.`,
          `Write \`${to.order}. ${to.nodeId} (write)\` or \`(read)\`. Assuming read.`,
        )
      }
    }

    const edge: GraphEdge = {
      id: `wf/${id}/${from.order}`,
      from: from.nodeId,
      to: to.nodeId,
      kind,
      ...(annotations.label ? { label: annotations.label } : {}),
      workflowId: id,
      order: from.order,
      ...(annotations.condition ? { condition: annotations.condition } : {}),
      ...(to.role ? { role: to.role } : {}),
      source: to.source,
    }
    if (addEdge(b, edge)) from.edgeId = edge.id
  }

  for (const step of steps) delete (step as WorkflowStep & { _ann?: StepAnnotations })._ann

  // -------------------------------------------------------------- error paths
  const errors: WorkflowError[] = []
  for (let i = 0; i < raw.errors.length; i++) {
    const rawError = raw.errors[i]!
    const atNodeId = reference(b, rawError.at, rawError.line, file, diag, CODES.UNKNOWN_NODE_REF)
    const atNode = b.nodes.get(atNodeId)!

    // An error target may be declared inline. This is the single exception to
    // "declare nodes first": an error is a leaf annotation on a step, not a shared
    // entity, and requiring a catalog entry for "missing dates" is pure bureaucracy.
    let errorNodeId: string
    if (rawError.to) {
      errorNodeId = normalizeId(rawError.to)
    } else {
      errorNodeId = `error/${slug(rawError.reason)}`
      let n = 2
      while (b.nodes.has(errorNodeId) && b.nodes.get(errorNodeId)!.kind !== 'error') {
        errorNodeId = `error/${slug(rawError.reason)}-${n++}`
      }
    }

    if (!b.nodes.has(errorNodeId)) {
      b.nodes.set(errorNodeId, {
        id: errorNodeId,
        kind: 'error',
        // Errors sit in the same layer as the step they branch from, so they stay
        // spatially next to their cause instead of collecting in a corner.
        layer: atNode.layer,
        name: rawError.reason,
        ...(atNode.module ? { module: atNode.module } : {}),
        roles: [],
        meta: {},
        workflows: [],
        rolesReached: [],
        implicit: true,
        source: { file, line: rawError.line },
      })
    }

    const edgeId = `wf/${id}/error/${i + 1}`
    addEdge(b, {
      id: edgeId,
      from: atNodeId,
      to: errorNodeId,
      kind: 'error',
      label: rawError.reason,
      workflowId: id,
      source: { file, line: rawError.line },
    })

    errors.push({
      atNodeId,
      errorNodeId,
      reason: rawError.reason,
      edgeId,
      source: { file, line: rawError.line },
    })
  }

  return {
    id,
    name: nameProp?.value || humanize(id),
    ...(descProp?.value || raw.prose.length
      ? { description: descProp?.value || raw.prose.join(' ') }
      : {}),
    roles,
    steps,
    errors,
    meta,
    source: { file, line: raw.line },
  }
}
