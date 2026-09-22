/**
 * Stage 2: blocks -> raw intermediate representation.
 *
 * Purely structural. Nothing here resolves references, infers kinds or builds edges —
 * that is resolve.ts. This stage only answers "what did the author literally write?".
 */

import { clean, type Block } from './scan.js'
import { CODES, type DiagnosticBag } from './diagnostics.js'

export interface Prop {
  value: string
  line: number
}

export interface RawNode {
  id: string
  line: number
  module?: string
  props: Map<string, Prop>
  /** Prose lines under the node heading, used when no explicit `Description:` is given. */
  prose: string[]
}

export interface RawStep {
  ref: string
  annotations: string[]
  note?: string
  line: number
}

export interface RawErrorLine {
  at: string
  to?: string
  reason: string
  line: number
}

export interface RawWorkflow {
  id: string
  line: number
  props: Map<string, Prop>
  prose: string[]
  steps: RawStep[]
  errors: RawErrorLine[]
}

export interface RawDoc {
  title?: string
  titleLine: number
  meta: Map<string, Prop>
  nodes: RawNode[]
  workflows: RawWorkflow[]
  modules: Map<string, number>
}

const STEP_NOTE = /\s+(?:—|–|--)\s+/
const STEP_ANNOTATIONS = /^(.*?)\s*\(([^()]*)\)\s*$/
const ARROW = /\s*(?:->|=>|→)\s*/

/** `apply-leave-page (write, role: Admin) — employee submits the form` */
export function parseStep(text: string, line: number): RawStep | null {
  const [headRaw, ...noteParts] = text.split(STEP_NOTE)
  let head = (headRaw ?? '').trim()
  const note = noteParts.join(' — ').trim() || undefined

  let annotations: string[] = []
  const withAnnotations = STEP_ANNOTATIONS.exec(head)
  if (withAnnotations) {
    head = withAnnotations[1]!.trim()
    annotations = withAnnotations[2]!
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
  }

  const ref = clean(head)
  if (!ref) return null
  return { ref, annotations, ...(note ? { note } : {}), line }
}

/**
 * `at post-leaves -> validation-error: missing dates`
 * `at post-leaves: missing dates`            (error node created from the reason)
 */
export function parseErrorLine(text: string, line: number): RawErrorLine | null {
  const body = text.replace(/^at\s+/i, '').trim()
  if (!body) return null

  if (ARROW.test(body)) {
    const [leftRaw, rightRaw] = body.split(ARROW)
    const left = clean(leftRaw ?? '')
    const right = (rightRaw ?? '').trim()
    const colon = right.indexOf(':')
    if (!left || colon < 0) return null
    const to = clean(right.slice(0, colon))
    const reason = right.slice(colon + 1).trim()
    if (!to || !reason) return null
    return { at: left, to, reason, line }
  }

  const colon = body.indexOf(':')
  if (colon < 0) return null
  const at = clean(body.slice(0, colon))
  const reason = body.slice(colon + 1).trim()
  if (!at || !reason) return null
  return { at, reason, line }
}

const STEPS_KEYS = new Set(['steps', 'flow', 'sequence'])
const ERRORS_KEYS = new Set(['errors', 'error paths', 'error-paths', 'failures', 'failure paths'])

export function extract(blocks: Block[], diag: DiagnosticBag): RawDoc {
  const doc: RawDoc = {
    titleLine: 0,
    meta: new Map(),
    nodes: [],
    workflows: [],
    modules: new Map(),
  }

  let node: RawNode | null = null
  let workflow: RawWorkflow | null = null
  let currentModule: string | undefined
  let listMode: 'steps' | 'errors' | null = null

  const closeEntities = () => {
    node = null
    workflow = null
    listMode = null
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      const kind = block.kind

      if (kind === 'module') {
        closeEntities()
        currentModule = block.value
        if (!doc.modules.has(block.value)) doc.modules.set(block.value, block.line)
        continue
      }

      if (kind === 'node') {
        workflow = null
        listMode = null
        node = {
          id: block.value,
          line: block.line,
          ...(currentModule ? { module: currentModule } : {}),
          props: new Map(),
          prose: [],
        }
        doc.nodes.push(node)
        continue
      }

      if (kind === 'workflow') {
        node = null
        listMode = null
        workflow = {
          id: block.value,
          line: block.line,
          props: new Map(),
          prose: [],
          steps: [],
          errors: [],
        }
        doc.workflows.push(workflow)
        continue
      }

      if (kind === 'app' || kind === 'document' || kind === 'title') {
        closeEntities()
        currentModule = undefined
        doc.title = block.value
        doc.titleLine = block.line
        continue
      }

      // Any other heading ends the current entity and the current module.
      closeEntities()
      currentModule = undefined
      if (block.depth === 1 && !doc.title) {
        doc.title = block.value
        doc.titleLine = block.line
      }
      continue
    }

    if (block.type === 'kv') {
      const key = block.key.toLowerCase()

      if (workflow && STEPS_KEYS.has(key)) {
        listMode = 'steps'
        // `Steps: a, b, c` shorthand for short function-scope documents.
        if (block.value) {
          for (const part of block.value.split(',')) {
            const step = parseStep(part, block.line)
            if (step) workflow.steps.push(step)
          }
        }
        continue
      }

      if (workflow && ERRORS_KEYS.has(key)) {
        listMode = 'errors'
        continue
      }

      listMode = null
      const target = node?.props ?? workflow?.props ?? doc.meta
      if (target.has(block.key)) {
        diag.warn(
          CODES.STRAY_CONTENT,
          block.line,
          `Duplicate key "${block.key}"; the later value wins.`,
        )
      }
      target.set(block.key, { value: block.value, line: block.line })
      continue
    }

    if (block.type === 'ordered' || block.type === 'bullet') {
      if (!workflow) continue // prose lists outside workflows are just prose

      if (listMode === 'errors') {
        const parsed = parseErrorLine(block.value, block.line)
        if (parsed) workflow.errors.push(parsed)
        else
          diag.error(
            CODES.INVALID_ERROR,
            block.line,
            `Could not parse error path: "${block.value}".`,
            'Expected `at <node-id> -> <error-id>: <reason>` or `at <node-id>: <reason>`.',
          )
        continue
      }

      // Ordered lists inside a workflow are steps, whether or not `Steps:` was written.
      if (block.type === 'ordered' || listMode === 'steps') {
        const parsed = parseStep(block.value, block.line)
        if (parsed) workflow.steps.push(parsed)
        else
          diag.error(
            CODES.INVALID_STEP,
            block.line,
            `Could not parse step: "${block.value}".`,
            'Expected `<node-id> [(annotations)] [— note]`.',
          )
      }
      continue
    }

    if (block.type === 'text') {
      if (node) node.prose.push(block.value)
      else if (workflow) workflow.prose.push(block.value)
    }
  }

  return doc
}
