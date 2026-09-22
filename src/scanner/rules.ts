/**
 * The evidence table.
 *
 * Every framework this understands is a row here, not a code path — adding Rails or Laravel
 * or Actix means adding entries, never touching the walker. Nothing in this file knows about
 * any particular repository.
 *
 * The rules only recognise things that are *written down* in the source: a route declaration,
 * a model definition, an HTTP call. They never infer intent. That boundary is deliberate —
 * a scanner can see that a file declares `POST /api/leaves`, but not that this is step 4 of
 * applying for leave, and guessing would produce exactly the confident-but-wrong document
 * the whole format exists to prevent.
 */

import type { NodeKind } from '../schema/kinds.js'

export interface Match {
  kind: NodeKind
  name: string
  meta: Record<string, string>
  /** Declared HTTP route, used to link callers to endpoints. */
  route?: { method: string; path: string }
  /** An outbound HTTP call, matched against declared routes later. */
  calls?: { method?: string; path: string }
  /** An HTTP call whose URL is computed, so it cannot be matched to a route. */
  unresolvedCall?: { method?: string; expression: string }
}

export interface Rule {
  id: string
  /** Shown as provenance on the generated node. */
  label: string
  /** Which files the rule applies to, tested against the POSIX-style relative path. */
  files: RegExp
  /** Applied per line. Use named or positional groups. */
  pattern: RegExp
  build: (match: RegExpExecArray) => Match | null
}

const SOURCE = /\.(js|jsx|mjs|cjs|ts|tsx|py|go|java|kt|rb|cs|php|rs)$/i
const JS = /\.(js|jsx|mjs|cjs|ts|tsx)$/i
const PY = /\.py$/i

const upper = (text: string) => text.toUpperCase()

/** `${API}/leaves` and `/api/${id}` normalise to something comparable across call sites. */
export function normalisePath(raw: string): string {
  let path = raw
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/["'`]/g, '')
    .replace(/\?.*$/, '')
    .trim()
  if (!path.startsWith('/')) path = `/${path}`
  return path.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
}

const endpoint = (method: string, rawPath: string, label: string): Match => {
  const path = normalisePath(rawPath)
  return {
    kind: 'api',
    name: `${upper(method)} ${path}`,
    meta: { Method: upper(method), Path: path, Found: label },
    route: { method: upper(method), path },
  }
}

export const RULES: readonly Rule[] = [
  // ------------------------------------------------------------------ HTTP routes
  {
    id: 'express',
    label: 'Express/Koa/Fastify router',
    files: JS,
    // Deliberately excludes `api` and `client`: in a frontend, `api.get('/users')` is a call
    // to a route, not a declaration of one, and counting it as an endpoint would invent a
    // server that does not exist.
    pattern: /\b(?:router|app|server)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]*)['"`]/i,
    build: (m) => endpoint(m[1]!, m[2]!, 'Express-style route'),
  },
  {
    id: 'decorator-http',
    label: 'FastAPI / decorator route',
    files: /\.(py|ts)$/i,
    pattern: /@\s*(?:\w+\s*\.\s*)?(get|post|put|patch|delete)\s*\(\s*['"]([^'"]*)['"]/i,
    build: (m) => endpoint(m[1]!, m[2]!, 'decorator route'),
  },
  {
    id: 'flask-route',
    label: 'Flask route',
    files: PY,
    pattern: /@\s*\w+\.route\s*\(\s*['"]([^'"]*)['"](?:.*?methods\s*=\s*\[([^\]]*)\])?/i,
    build: (m) => {
      const methods = (m[2] ?? 'GET').replace(/['"\s]/g, '').split(',').filter(Boolean)
      return endpoint(methods[0] ?? 'GET', m[1]!, 'Flask route')
    },
  },
  {
    id: 'django-path',
    label: 'Django URLconf',
    files: PY,
    pattern: /\b(?:path|re_path|url)\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+)/,
    build: (m) => ({
      ...endpoint('GET', m[1]!, 'Django URLconf'),
      meta: { Path: normalisePath(m[1]!), View: m[2]!, Found: 'Django URLconf' },
    }),
  },
  {
    id: 'nest-decorator',
    label: 'NestJS route decorator',
    files: /\.ts$/i,
    pattern: /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:['"]([^'"]*)['"])?\s*\)/,
    build: (m) => endpoint(m[1]!, m[2] ?? '/', 'NestJS decorator'),
  },
  {
    id: 'spring-mapping',
    label: 'Spring request mapping',
    files: /\.(java|kt)$/i,
    pattern: /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/,
    build: (m) => endpoint(m[1]!, m[2]!, 'Spring mapping'),
  },
  {
    id: 'aspnet-attribute',
    label: 'ASP.NET route attribute',
    files: /\.cs$/i,
    pattern: /\[Http(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]*)"/,
    build: (m) => endpoint(m[1]!, m[2]!, 'ASP.NET attribute'),
  },
  {
    id: 'go-mux',
    label: 'Go router',
    files: /\.go$/i,
    pattern: /\b\w+\.(GET|POST|PUT|PATCH|DELETE|HandleFunc)\s*\(\s*"([^"]*)"/,
    build: (m) =>
      endpoint(m[1] === 'HandleFunc' ? 'GET' : m[1]!, m[2]!, 'Go router'),
  },
  {
    id: 'rails-routes',
    label: 'Rails routes',
    files: /routes\.rb$/i,
    pattern: /^\s*(get|post|put|patch|delete)\s+['"]([^'"]*)['"]/i,
    build: (m) => endpoint(m[1]!, m[2]!, 'Rails route'),
  },

  // ------------------------------------------------------------------ data
  {
    id: 'mongoose-model',
    label: 'Mongoose model',
    files: JS,
    pattern: /mongoose\s*\.\s*model\s*\(\s*['"]([^'"]+)['"]/,
    build: (m) => ({ kind: 'entity', name: m[1]!, meta: { Store: 'MongoDB', Found: 'mongoose.model' } }),
  },
  {
    id: 'sequelize-define',
    label: 'Sequelize model',
    files: JS,
    pattern: /\.\s*define\s*\(\s*['"]([^'"]+)['"]/,
    build: (m) => ({ kind: 'entity', name: m[1]!, meta: { Found: 'sequelize.define' } }),
  },
  {
    id: 'prisma-model',
    label: 'Prisma schema',
    files: /schema\.prisma$/i,
    pattern: /^\s*model\s+(\w+)\s*\{/,
    build: (m) => ({ kind: 'entity', name: m[1]!, meta: { Found: 'Prisma model' } }),
  },
  {
    id: 'typeorm-entity',
    label: 'TypeORM entity',
    files: /\.ts$/i,
    pattern: /@Entity\s*\(\s*(?:['"]([^'"]+)['"])?\s*\)/,
    build: (m) => (m[1] ? { kind: 'entity', name: m[1], meta: { Found: '@Entity' } } : null),
  },
  {
    id: 'django-model',
    label: 'Django model',
    files: PY,
    pattern: /^\s*class\s+(\w+)\s*\(\s*(?:models\.)?Model\s*\)/,
    build: (m) => ({ kind: 'entity', name: m[1]!, meta: { Found: 'Django model' } }),
  },
  {
    id: 'sqlalchemy-table',
    label: 'SQLAlchemy table',
    files: PY,
    pattern: /__tablename__\s*=\s*['"]([^'"]+)['"]/,
    build: (m) => ({ kind: 'entity', name: m[1]!, meta: { Found: '__tablename__' } }),
  },
  {
    id: 'sql-ddl',
    label: 'SQL DDL',
    files: /\.(sql)$/i,
    pattern: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/i,
    build: (m) => ({ kind: 'entity', name: m[1]!, meta: { Found: 'CREATE TABLE' } }),
  },

  // ------------------------------------------------------------------ outbound calls
  {
    id: 'axios-call',
    label: 'HTTP client call',
    files: JS,
    pattern: /\b(?:axios|api|client|instance|http|axiosInstance)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*[`'"]([^`'"]*)/i,
    build: (m) => ({
      kind: 'function',
      name: `calls ${upper(m[1]!)} ${normalisePath(m[2]!)}`,
      meta: {},
      calls: { method: upper(m[1]!), path: normalisePath(m[2]!) },
    }),
  },
  {
    id: 'fetch-call',
    label: 'fetch()',
    files: JS,
    pattern: /\bfetch\s*\(\s*[`'"]([^`'"]*)/,
    build: (m) => ({
      kind: 'function',
      name: `calls ${normalisePath(m[1]!)}`,
      meta: {},
      calls: { path: normalisePath(m[1]!) },
    }),
  },
  {
    id: 'angular-http',
    label: 'Angular HttpClient',
    files: /\.ts$/i,
    pattern: /\.http\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*[`'"]([^`'"]*)/i,
    build: (m) => ({
      kind: 'function',
      name: `calls ${upper(m[1]!)} ${normalisePath(m[2]!)}`,
      meta: {},
      calls: { method: upper(m[1]!), path: normalisePath(m[2]!) },
    }),
  },
  {
    id: 'base-plus-path',
    label: 'HTTP call built as BASE + path',
    files: /\.(js|jsx|mjs|cjs|ts|tsx|py)$/i,
    // `this.http.get(BACKEND_URL + '/auth/login')` — the concatenated literal IS the route,
    // so this resolves cleanly even though the full URL is computed. Dominant in Angular and
    // common everywhere a base URL lives in config.
    pattern: /\b(?:axios|api|apiClient|client|instance|http|axiosInstance|request|requests|httpx)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*[A-Za-z_$][\w$.]*\s*\+\s*[`'"]([^`'"]*)/i,
    build: (m) => ({
      kind: 'function',
      name: `calls ${upper(m[1]!)} ${normalisePath(m[2]!)}`,
      meta: {},
      calls: { method: upper(m[1]!), path: normalisePath(m[2]!) },
    }),
  },
  {
    id: 'computed-url-call',
    label: 'HTTP call with a computed URL',
    files: /\.(js|jsx|mjs|cjs|ts|tsx|py)$/i,
    // `this.http.get(url)` / `axios.post(endpoint, body)`. The URL is a variable, so which
    // route it hits is a dataflow question this scanner deliberately does not answer —
    // resolving it would mean guessing, and a wrong edge is worse than a missing one. These
    // are counted and surfaced as open questions instead.
    pattern: /\b(?:axios|api|apiClient|client|instance|http|axiosInstance|request|requests|httpx)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([A-Za-z_$][\w$.[\]]*)\s*[,)]/i,
    build: (m) => ({
      kind: 'function',
      name: `calls ${upper(m[1]!)} (computed)`,
      meta: {},
      unresolvedCall: { method: upper(m[1]!), expression: m[2]! },
    }),
  },
  {
    id: 'python-requests',
    label: 'requests / httpx',
    files: PY,
    pattern: /\b(?:requests|httpx|client)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*[`'"]([^`'"]*)/i,
    build: (m) => ({
      kind: 'function',
      name: `calls ${upper(m[1]!)} ${normalisePath(m[2]!)}`,
      meta: {},
      calls: { method: upper(m[1]!), path: normalisePath(m[2]!) },
    }),
  },
]

/**
 * Where no rule fires, structure still carries meaning: almost every codebase in every
 * language puts screens under `pages/` or `views/`, business logic under `services/`, and
 * background work under `jobs/`. These conventions are the fallback, and because they are
 * weaker evidence than a parsed declaration they are reported as such.
 */
export const PATH_CONVENTIONS: ReadonlyArray<{
  id: string
  kind: NodeKind
  test: RegExp
  label: string
}> = [
  { id: 'page-dir', kind: 'ui', test: /(?:^|\/)(?:pages|screens|views)\//i, label: 'pages/ directory' },
  { id: 'component-file', kind: 'component', test: /\.component\.(?:ts|js)$/i, label: 'Angular component' },
  { id: 'component-dir', kind: 'component', test: /(?:^|\/)components?\//i, label: 'components/ directory' },
  { id: 'controller', kind: 'controller', test: /(?:^|\/)controllers?\/|[._-]controller\.|Controller\.\w+$/i, label: 'controller' },
  { id: 'service', kind: 'service', test: /(?:^|\/)(?:services?|usecases?|domain)\/|[._-]service\.|Service\.\w+$/i, label: 'service' },
  { id: 'job', kind: 'job', test: /(?:^|\/)(?:jobs?|workers?|tasks?|cron|queues?)\//i, label: 'background job' },
  { id: 'middleware', kind: 'decision', test: /(?:^|\/)middlewares?\/|[._-]guard\./i, label: 'middleware/guard' },
  { id: 'model', kind: 'entity', test: /(?:^|\/)(?:models?|entities|schemas?)\//i, label: 'models/ directory' },
]

/** File extensions worth opening at all. */
export const SCANNABLE = new RegExp(`${SOURCE.source}|\\.(sql|prisma|vue|svelte)$`, 'i')

/** Directories never worth walking. */
export const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  'coverage', '.next', '.nuxt', '.vite', '.angular', '.cache', 'vendor',
  'venv', '.venv', 'env', '__pycache__', 'migrations', 'uploads', 'logs',
  'public', 'static', 'assets', '.idea', '.vscode', 'test_reports',
])
