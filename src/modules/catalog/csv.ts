/**
 * Menu CSV import (pure). Columns (header row required, order free):
 *   name, category, price, cost [, kind, anchorable, tags, sku, description]
 * Prices and costs are in major units ("22.50"). Tags are separated by "|".
 */
import { toCents } from "@/core/money";
import type { CatalogItemInput, ItemKind } from "./types";

export interface CsvImportResult {
  items: (CatalogItemInput & { sku: string | null })[];
  errors: { line: number; message: string }[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

const truthy = (v: string | undefined) => ["1", "true", "yes", "y"].includes((v ?? "").toLowerCase());

export function parseMenuCsv(text: string): CsvImportResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  const result: CsvImportResult = { items: [], errors: [] };
  if (lines.length === 0) return result;
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const required of ["name", "category", "price", "cost"]) {
    if (col(required) === -1) {
      result.errors.push({ line: 1, message: `Missing column "${required}"` });
      return result;
    }
  }
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const get = (name: string) => (col(name) >= 0 ? cells[col(name)] : undefined);
    const name = get("name");
    const category = get("category")?.toLowerCase().replace(/\s+/g, "_");
    const price = Number(get("price"));
    const cost = Number(get("cost"));
    if (!name || !category) {
      result.errors.push({ line: i + 1, message: "Name and category are required" });
      continue;
    }
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0) {
      result.errors.push({ line: i + 1, message: "Price and cost must be numbers ≥ 0" });
      continue;
    }
    if (cost > price && price > 0) result.errors.push({ line: i + 1, message: `Warning: cost is above price for "${name}"` });
    const kind = (get("kind")?.toLowerCase() === "service" ? "service" : "product") as ItemKind;
    result.items.push({
      name,
      category,
      kind,
      priceCents: toCents(price),
      costCents: toCents(cost),
      anchorable: truthy(get("anchorable")),
      tags: (get("tags") ?? "").split("|").map((t) => t.trim()).filter(Boolean),
      description: get("description") || null,
      sku: get("sku") || null,
    });
  }
  return result;
}
