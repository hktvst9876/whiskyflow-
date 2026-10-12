# catalog — menu items and services

**Owns:** `catalog_items` (price **and approximate cost** — cost drives every economic decision; optional SKU for POS matching).

**Public API:** `parseMenuCsv` (columns `name, category, price, cost [, kind, anchorable, tags, sku, description]`, major units); server `repo.ts` (`listItems`, `insertItem`, `updateItem`, `matchItem` by SKU then name).
