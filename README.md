# Return Anchor

Return Anchor is a retention operating system for restaurants, bars, beer concepts and repeat-service businesses. It turns a normal purchase into a small, tangible item the customer still owns — a main, pint, bottle balance or session — then helps the merchant earn fresh gross profit when the customer returns.

The MVP tests one question: **does deliberately creating a Return Anchor increase incremental profitable customer lifetime value?** It therefore records both attributed activity and a randomised holdout. Redemption volume alone is never presented as causal lift.

## What is included

- Next.js 16 App Router console for owners, managers and till staff
- Dynamic checkout engine that proposes one profitable anchor or `NO_OFFER`
- Customer web wallet and QR claim flow, with no native app required
- POS-lite bill simulator and a generic POS ingestion API
- Return Score, automatic segments and next-action playbooks
- WhatsApp provider interface with demo, console and Meta Cloud adapters
- Append-only entitlement ledger with auditable issue, claim and redemption events
- Revenue attribution plus treatment/holdout contribution-lift reporting
- Restaurant, bar, beer-pub and service presets with seeded demo histories
- PostgreSQL schema and migrations through Drizzle ORM

## Run locally

Requirements: Node.js 22+ and pnpm 11. Development can use embedded PGlite, so a separate database is optional.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3210` and sign in with `owner@demo.returnanchor.app` / `demo1234`. The first development start creates and seeds the embedded database.

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Production database

Set `DATABASE_URL` to a PostgreSQL connection string. Supabase Postgres works without a proprietary database layer; authentication remains in the application so merchant roles and public wallet tokens use the same audited model.

```bash
pnpm db:migrate
pnpm build
pnpm start
```

Set a random `APP_SECRET` of at least 32 characters in production. It signs session, claim and wallet tokens. Set `APP_URL` to the public HTTPS origin so QR codes and WhatsApp buttons resolve correctly. See [.env.example](./.env.example) for every setting.

## Architecture

The app is a modular monolith so the experiment can ship quickly while boundaries remain explicit:

```text
app/                    Next.js pages, server actions and HTTP routes
src/flows/              End-to-end application workflows
src/modules/            Domain modules, engines, repositories and schemas
src/integrations/       POS, WhatsApp and wallet-pass adapter interfaces
src/verticals/          Restaurant, bar, beer and service presets
drizzle/                PostgreSQL migrations
tests/                  Unit and full-loop integration tests
docs/                   Product specification and architecture blueprint
```

All amounts are integer minor units. A Return Anchor balance is maintained by an append-only ledger and a transactionally updated current balance. Merchant data is scoped by `merchantId`; server actions derive that tenant from the signed session.

The checkout engine:

1. Reads the organic bill and approved merchant programmes.
2. Generates valid price points for each matching Return Anchor.
3. Estimates today’s margin, return lift, next-visit gross profit, acceptance and expected contribution.
4. Applies hard rules: no stacking, margin and contribution floors, cooldowns, promotional budget, active-anchor cap, liability cap, blackout windows and anti-escalation.
5. Ranks passing candidates and shows at most one. If none pass, it records `NO_OFFER` and the reasons.
6. Assigns eligible bills to treatment or holdout once. The result is stored so staff cannot reroll it.
7. Uses measured lift only after the sample threshold; hard rules remain deterministic.

The AI layer is constrained. A language model can later help create copy or propose candidates inside the approved catalogue, but it never sets cost, margin, consent or final eligibility. The policy engine validates every candidate and can always choose `NO_OFFER`.

## POS integration

`src/integrations/pos/adapter.ts` defines the adapter interface. Vendor adapters convert source events into the canonical order in `src/integrations/pos/canonical.ts`.

Send events to `POST /api/v1/pos/orders` with `Authorization: Bearer <api-key>` and an optional `X-POS-Adapter` header. Reusing `externalRef` updates the same open bill. The response includes the stored offer decision and staff copy. API keys are stored only as hashes, are revocable, and require `pos:write`.

Create a merchant-scoped key with `pnpm api-key:create -- --merchant abc-kitchen --name n8n`. Copy the raw value when printed; it cannot be recovered later.

## n8n integration points

n8n orchestrates transport; it is not the database or decision engine.

- **POS order event:** POS webhook → map vendor fields → `POST /api/v1/pos/orders` → send returned staff offer to the POS/tablet.
- **Scheduler:** every five minutes → `POST /api/cron/tick` using `Authorization: Bearer $CRON_SECRET`.
- **Daily summary:** schedule trigger → protected report/read-only database view → email or WhatsApp.
- **Low inventory:** inventory webhook → n8n notification; inventory availability must also gate candidates before production offers.
- **Suspicious redemption:** fraud/audit event → n8n → manager channel.
- **Opt-out sync:** WhatsApp webhook → application consent endpoint → n8n mirrors state to the CRM.

Keep API keys and WhatsApp credentials in n8n credentials, not workflow JSON. Let n8n retry transport failures; idempotency belongs in the app.

## Security and trust

- Passwords use scrypt; session tokens and API keys are stored as hashes.
- Claim links are single-use, time-limited and rate-limited. Wallet tokens are revocable and never stored in plaintext.
- Public pages use `noindex` and `no-referrer`; purchase history is never shown on a public table screen.
- Consent is recorded per purpose and notice version. Service and marketing consent are separate.
- Offer and redemption mutations use database transactions, tenant checks and append-only audits.
- Entitlement terms are frozen at issue time, so later merchant changes do not alter ownership.
- Production requires HTTPS, backups, secret rotation, least-privilege scopes and webhook signature verification.

## Product documentation

- [Architecture blueprint](./docs/architecture/blueprint.md)
- [n8n integration and importable workflow](./docs/architecture/n8n-integration.md)
- [Product specification](./docs/product/01-product-spec.md)
- [Personas and journeys](./docs/product/02-personas-and-journeys.md)
- [Roadmap and MVP boundaries](./docs/product/roadmap.md)

The old TablePulse prototype is preserved under `legacy/tablepulse` and excluded from the current build.
