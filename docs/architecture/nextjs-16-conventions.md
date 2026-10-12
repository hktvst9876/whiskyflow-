# Next.js 16 conventions for this repo

Next 16.3 / React 19.3, App Router, Turbopack. `cacheComponents` is **off**, so the
"previous" caching model applies. These rules were verified against
`node_modules/next/dist/docs/`; read the guide there before deviating.

## Request APIs are async
- `params` and `searchParams` are **Promises**:
  `export default async function Page({ params }: { params: Promise<{ token: string }> }) { const { token } = await params }`.
  `searchParams` is a plain object (`Promise<Record<string, string | string[] | undefined>>`).
  Layouts do not receive `searchParams`. In client components use `use(params)`.
- Prefer explicit prop types over generated `PageProps<'/route'>` helpers (they only exist after `next dev`/`typegen`; `pnpm typecheck` must pass on a clean checkout).
- `cookies()` / `headers()` are async: `(await cookies()).get(name)`. Setting/deleting cookies works **only** in Server Actions and Route Handlers.

## Rendering and the build
- A page that uses no request-time API is prerendered at `next build` — it would open the DB at build time. Any page that reads the DB without calling `requireAuth()`/`cookies()` must `await connection()` (from `next/server`) or `export const dynamic = "force-dynamic"`. `[token]` pages and pages calling `requireAuth()` are dynamic automatically.
- Do not use `'use cache'`, `cacheLife` or `cacheTag` (cacheComponents is off). After a mutation call `revalidatePath("/path")` (patterns need the type: `revalidatePath("/w/[token]", "page")`) or `refresh()` from `next/cache`. `revalidateTag` needs two args.

## Layouts, groups, errors
- `app/layout.tsx` renders `<html><body>`, imports `./globals.css`, exports `metadata`. Never hand-write `<head>`.
- Layouts are **not** a security boundary and do not re-render on navigation: every page, query and action calls `requireAuth()` (or `withAuth()` in `src/server/action.ts`) itself.
- Route groups `(console)` and `(staff)` must not resolve to the same URL. A `route.ts` cannot share a segment with a `page.tsx`.
- `error.tsx` is `'use client'` with props `{ error: Error & { digest?: string }; reset: () => void }`. `global-error.tsx` renders its own `<html><body>`. `forbidden()`/`unauthorized()` are NOT enabled — render a 403 view or map `ForbiddenError`.

## Server actions
- A file with a top-level `'use server'` may export **only async functions** (no constants or schemas).
- They are public POST endpoints: validate input with Zod, call `withAuth(minRole)` (which calls `requireAuth`), derive `merchantId` from the session — never from the form.
- With `useActionState`: `(prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>`; client: `const [state, formAction, pending] = useActionState(action, initialActionState)`.
- `redirect()` / `notFound()` throw. `runAction()` re-throws them via `unstable_rethrow`. Call `revalidatePath` **before** `redirect`.
- Return small serialisable view models (no `Set`, `Map`, class instances; `Date` is fine).

## Route handlers
- `export async function POST(request: Request, ctx: { params: Promise<{...}> })`, not cached by default. Return `Response.json(body, { status })`; map errors with `errorResponse()` from `src/server/action.ts`.
- WhatsApp webhook: read `await request.text()` and verify `X-Hub-Signature-256` **before** parsing JSON.
- Auth in handlers is the API key, `CRON_SECRET` or the webhook signature — never cookies, never `requireAuth()` (it redirects).

## Client boundary
- `'use client'` components get serialisable props only and must never import `repo.ts`, `service.ts`, `queries.ts`, `src/server/*`, `src/flows/*` or `@/modules/auth/session`.
- `@/*` maps to `src/*` only; shared UI lives in `src/ui` (imports from `@/core` only).

## Flows stay framework-free
`src/flows/*` never import `next/*` or `@/modules/auth/session`; tests run them with Node + tsx and no Next runtime. Cookies, redirects and revalidation live in actions and route handlers.

## Token pages
`/c/[token]` and `/w/[token]` export `metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" }` so tokens are not indexed or leaked through `Referer`.

## Tailwind 4
`app/globals.css` starts with `@import "tailwindcss";` then `@theme { … }` tokens; there is no `tailwind.config.js`. Add `@source not "../legacy";` so the legacy prototype is not scanned.

## Dev server
`pnpm dev` binds `127.0.0.1:3210`. `instrumentation.ts` (repo root) `register()` runs once per server start (guard with `process.env.NEXT_RUNTIME === "nodejs"`).
