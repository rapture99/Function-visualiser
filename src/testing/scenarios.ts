/**
 * The eight edits that layout stability is measured against.
 *
 * Position stability is the property most likely to be quietly got wrong, and the one that
 * decides whether the map survives the Phase 6 hot-reload loop: the layout is recomputed on
 * every Markdown save while the user is looking at it. So stability is tested mechanically,
 * as a diff between two layouts of two documents, rather than by eye.
 *
 * Each scenario is a textual edit to the real sample document. Every mutation asserts that
 * its anchor was found — a find/replace that silently matched nothing would produce an
 * identical document and therefore a perfect, meaningless stability score.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Impact the layout engine is expected to have for a scenario. */
export type Impact = 'none' | 'imperceptible' | 'same-neighbourhood' | 'arbitrary'

export interface EditScenario {
  id: string
  title: string
  /** Why this edit discriminates between layout approaches. */
  discriminates: string
  /** The worst impact considered acceptable. */
  budget: Impact
  apply(base: string): string
}

export function loadBaseDocument(): string {
  const path = fileURLToPath(new URL('./fixtures/sample-system.md', import.meta.url))
  // Normalise line endings so the mutations below can anchor on \n regardless of checkout.
  return readFileSync(path, 'utf8').split('\r\n').join('\n')
}

function replaceOnce(text: string, find: string, replacement: string): string {
  const first = text.indexOf(find)
  if (first < 0) throw new Error(`scenario anchor not found:\n${find}`)
  if (text.indexOf(find, first + find.length) >= 0) {
    throw new Error(`scenario anchor is ambiguous (matches more than once):\n${find}`)
  }
  return text.slice(0, first) + replacement + text.slice(first + find.length)
}

function removeOnce(text: string, find: string): string {
  return replaceOnce(text, find, '')
}

/**
 * Rewrite a workflow's `Steps:` list. Step numbers are re-derived, so inserting or
 * reordering never leaves the fixture with a misnumbered list. (The parser takes order from
 * position rather than the written number, but a wrong fixture is a trap for the next
 * person reading it.)
 */
export function withSteps(
  text: string,
  workflowId: string,
  transform: (steps: string[]) => string[],
): string {
  const lines = text.split('\n')
  const heading = new RegExp(`^##\\s+Workflow:\\s*${workflowId}\\s*$`)

  const start = lines.findIndex((l) => heading.test(l.trim()))
  if (start < 0) throw new Error(`workflow "${workflowId}" not found`)

  const stepsAt = lines.findIndex((l, i) => i > start && /^steps:\s*$/i.test(l.trim()))
  if (stepsAt < 0) throw new Error(`no Steps: block in workflow "${workflowId}"`)

  let end = stepsAt + 1
  const items: string[] = []
  while (end < lines.length) {
    const match = /^\s*\d+[.)]\s+(.*)$/.exec(lines[end]!)
    if (!match) break
    items.push(match[1]!.trim())
    end++
  }
  if (items.length === 0) throw new Error(`workflow "${workflowId}" has no steps`)

  const rewritten = transform(items).map((step, i) => `${i + 1}. ${step}`)
  return [...lines.slice(0, stepsAt + 1), ...rewritten, ...lines.slice(end)].join('\n')
}

function insertAt<T>(items: T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index)]
}

function swap<T>(items: T[], a: number, b: number): T[] {
  const out = [...items]
  const tmp = out[a]!
  out[a] = out[b]!
  out[b] = tmp
  return out
}

export const SCENARIOS: readonly EditScenario[] = [
  {
    id: 'S1',
    title: 'Append a node at the end of an existing module',
    discriminates:
      'Cheap for any layout that assigns positions by ordinal, because nothing before it shifts.',
    budget: 'imperceptible',
    apply: (base) => {
      const withNode = replaceOnce(
        base,
        'Component: src/pages/leave/Approvals.tsx\n',
        'Component: src/pages/leave/Approvals.tsx\n\n### Node: leave-audit-log\nType: Table\nName: leave_audit_log\n',
      )
      return withSteps(withNode, 'reject-leave', (steps) => [
        ...steps,
        'leave-audit-log (write) — rejection recorded for audit',
      ])
    },
  },
  {
    id: 'S2',
    title: 'Insert a node at the start of an existing module, referenced mid-workflow',
    discriminates:
      'The counterpart to S1. Any layout keyed on document order or a dense ordinal shifts every ' +
      'later node in the module by one slot. Isolates document-order sensitivity exactly.',
    budget: 'same-neighbourhood',
    apply: (base) => {
      const withNode = replaceOnce(
        base,
        '## Module: Leave\n\n### Node: apply-leave-page',
        '## Module: Leave\n\n### Node: leave-policy\nType: Table\nName: leave_policies\n\n### Node: apply-leave-page',
      )
      return withSteps(withNode, 'apply-leave', (steps) =>
        insertAt(steps, 6, 'leave-policy (read) — grade policy for the employee'),
      )
    },
  },
  {
    id: 'S3',
    title: 'Rename a node; id unchanged',
    discriminates:
      'Pure display change. Any position movement at all is a bug — nothing structural changed.',
    budget: 'none',
    apply: (base) => replaceOnce(base, 'Name: LeaveService', 'Name: Leave domain service'),
  },
  {
    id: 'S4',
    title: 'Add an edge between two existing nodes',
    discriminates:
      'No new nodes. Force-directed and barycenter layouts respond globally to a single new ' +
      'edge; slot-based layouts do not move at all.',
    budget: 'same-neighbourhood',
    apply: (base) =>
      replaceOnce(
        base,
        '### Node: attendance-service\nType: Service\nName: AttendanceService',
        '### Node: attendance-service\nType: Service\nName: AttendanceService\nDependencies: leave-balance',
      ),
  },
  {
    id: 'S5',
    title: 'Add an entire new module and workflow',
    discriminates:
      'Tests whether module regions are allocated independently, or whether every module is ' +
      'repacked when the module count changes.',
    budget: 'same-neighbourhood',
    apply: (base) =>
      base +
      [
        '',
        '## Module: Audit',
        '',
        '### Node: audit-page',
        'Type: Page',
        'Name: Audit trail',
        '',
        '### Node: audit-service',
        'Type: Service',
        'Name: AuditService',
        '',
        '### Node: audit-entry',
        'Type: Table',
        'Name: audit_entries',
        '',
        '## Workflow: read-audit-trail',
        '',
        'Name: Read the audit trail',
        'Roles: Admin',
        '',
        'Steps:',
        '1. admin',
        '2. audit-page',
        '3. audit-service',
        '4. audit-entry (read)',
        '',
      ].join('\n'),
  },
  {
    id: 'S6',
    title: 'Delete a node and every reference to it',
    discriminates:
      'Deletion frees a slot. Tests whether the gap is left open (stable) or closed up by ' +
      'repacking (every later node shifts).',
    budget: 'imperceptible',
    apply: (base) => {
      let out = removeOnce(base, '\n### Node: email-provider\nType: External\nName: Email provider\nVendor: SMTP relay\n')
      out = removeOnce(out, '\nDependencies: email-provider')
      out = removeOnce(
        out,
        '\n- at email-provider: provider unreachable, notification is queued for retry',
      )
      return out
    },
  },
  {
    id: 'S7',
    title: 'Reorder two steps within one workflow',
    discriminates:
      'The node set is identical; only edge direction and workflow order change. Layouts that ' +
      'derive coordinates from workflow order will move nodes; layouts keyed on structure will not.',
    budget: 'same-neighbourhood',
    apply: (base) => withSteps(base, 'apply-leave', (steps) => swap(steps, 12, 13)),
  },
  {
    id: 'S8',
    title: 'Reformat with no semantic change whatsoever',
    discriminates:
      'The resulting graph is semantically identical — only declaration order and line numbers ' +
      'differ. ANY movement here proves the layout depends on document order, which is the ' +
      'subtlest and most annoying instability of all.',
    budget: 'none',
    apply: (base) =>
      replaceOnce(
        base,
        '### Node: attendance-service\nType: Service\nName: AttendanceService\n\n### Node: attendance-record\nType: Table\nName: attendance_records',
        '### Node: attendance-record\nType: Table\nName: attendance_records\n\n\n### Node: attendance-service\nType: Service\nName: AttendanceService',
      ),
  },
]
