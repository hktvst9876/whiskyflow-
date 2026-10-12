# merchants — tenants, settings, integrations

**Owns:** `merchants` (settings overrides JSON), `locations`, `api_keys`, `webhook_events`, `app_state` (demo clock, measured uplift cache).

**Settings:** `parseSettings(overrides, presetOverrides)` = defaults (`src/config/defaults.ts`) ← vertical preset ← merchant overrides, validated by `merchantSettingsSchema`. Always read through `loadMerchantContext`. Save only the keys a merchant changed.
