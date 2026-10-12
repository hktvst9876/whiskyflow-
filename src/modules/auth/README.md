# auth — users, sessions, roles

**Owns:** `users`, `memberships` (owner > manager > staff), `sessions` (hashed tokens, 14 days), `rate_limits`.

**Public API:** `service.ts` (`createUser`, `authenticate` — rate-limited, constant-time for unknown emails, `startSession`, `resolveSession`, `switchMerchant`); `session.ts` (Next glue: `getAuth`, `requireAuth(minRole)`, cookies). Every page/action/route authorises itself; layouts are not a security boundary. Pages and actions use `withAuth()` from `src/server/action.ts`.
