/**
 * The graph.json contract.
 *
 * This is the only thing the renderer is allowed to know about. The parser produces it;
 * the 3D view, the 2D view, the detail panel and any future consumer read it. Nothing
 * downstream ever touches Markdown.
 *
 * Deliberately contains NO timestamps or absolute paths: the output must be byte-stable
 * for the same input so hot-reload can diff two graphs and only move what actually moved.
 */

import { z } from 'zod'
import { EDGE_KINDS, LAYERS, NODE_KINDS } from './kinds.js'

export const SCHEMA_VERSION = 1

export const SEVERITIES = ['error', 'warning', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const SCOPES = ['system', 'feature', 'function', 'unspecified'] as const
export type Scope = (typeof SCOPES)[number]

export const zSourceRef = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
})

export const zDiagnostic = z.object({
  severity: z.enum(SEVERITIES),
  /** Stable machine-readable code, e.g. "unknown-node-ref". */
  code: z.string(),
  message: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  /** Optional actionable suggestion shown under the message. */
  hint: z.string().optional(),
})

export const zGraphNode = z.object({
  id: z.string(),
  kind: z.enum(NODE_KINDS),
  /** Derived from kind — see KIND_LAYER. Never authored. */
  layer: z.enum(LAYERS),
  name: z.string(),
  description: z.string().optional(),
  /** Module heading this node was declared under, if any. */
  module: z.string().optional(),
  /** Module node id, for collapse/expand. */
  parentId: z.string().optional(),
  /** Roles declared directly on the node (display only). */
  roles: z.array(z.string()),
  /** Every other `Key: Value` line, verbatim, for the detail panel. */
  meta: z.record(z.string(), z.string()),
  /** Derived: workflows that traverse this node. Precomputes "isolate workflow". */
  workflows: z.array(z.string()),
  /** Derived: roles that actually reach this node via some workflow. Powers role filtering. */
  rolesReached: z.array(z.string()),
  /** True for nodes the parser created rather than the author declaring them. */
  implicit: z.boolean(),
  source: zSourceRef,
})

export const zGraphEdge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(EDGE_KINDS),
  /** Short label rendered on/near the edge. */
  label: z.string().optional(),
  /** Set when this edge came from a workflow step rather than a declared dependency. */
  workflowId: z.string().optional(),
  /** 1-based step index within that workflow. Drives playback ordering. */
  order: z.number().int().positive().optional(),
  /** Guard text from a `when:` annotation. */
  condition: z.string().optional(),
  /** Acting role at this point in the workflow. */
  role: z.string().optional(),
  source: zSourceRef,
})

export const zWorkflowStep = z.object({
  order: z.number().int().positive(),
  nodeId: z.string(),
  note: z.string().optional(),
  /** Effective acting role: inherited from the workflow, or switched by a `role:` annotation. */
  role: z.string().optional(),
  /** Edge from this step to the next. Absent on the final step. */
  edgeId: z.string().optional(),
  source: zSourceRef,
})

export const zWorkflowError = z.object({
  atNodeId: z.string(),
  errorNodeId: z.string(),
  reason: z.string(),
  edgeId: z.string(),
  source: zSourceRef,
})

export const zWorkflow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  roles: z.array(z.string()),
  steps: z.array(zWorkflowStep),
  errors: z.array(zWorkflowError),
  meta: z.record(z.string(), z.string()),
  source: zSourceRef,
})

export const zGraph = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: z.object({
    title: z.string().optional(),
    scope: z.enum(SCOPES),
    /** Source file as given on the command line, relative. Never absolute. */
    source: z.string(),
    extra: z.record(z.string(), z.string()),
  }),
  nodes: z.array(zGraphNode),
  edges: z.array(zGraphEdge),
  workflows: z.array(zWorkflow),
  /** Shipped inside the graph so the viewer can surface authoring problems directly. */
  diagnostics: z.array(zDiagnostic),
})

export type SourceRef = z.infer<typeof zSourceRef>
export type Diagnostic = z.infer<typeof zDiagnostic>
export type GraphNode = z.infer<typeof zGraphNode>
export type GraphEdge = z.infer<typeof zGraphEdge>
export type WorkflowStep = z.infer<typeof zWorkflowStep>
export type WorkflowError = z.infer<typeof zWorkflowError>
export type Workflow = z.infer<typeof zWorkflow>
export type Graph = z.infer<typeof zGraph>

/** Validate an untrusted graph.json (used by the viewer at load time). */
export function parseGraph(input: unknown): Graph {
  return zGraph.parse(input)
}
