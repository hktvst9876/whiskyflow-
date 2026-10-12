# audit — append-only audit log

`writeAudit(db, entry)`. Every state change to entitlements, settings, consents, API keys and campaigns writes one row. Never store phone numbers, tokens or message bodies in `data`. `actor_id` must be a UUID or null.
