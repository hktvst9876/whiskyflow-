import { randomSecret, sha256 } from "../src/server/crypto";
import { getDb } from "../src/server/db";
import {
  findMerchantBySlug,
  insertApiKey,
} from "../src/modules/merchants/repo";

function argument(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
}

const slug = argument("merchant");
const name = argument("name") ?? "POS / n8n";
if (!slug) {
  console.error(
    "Usage: pnpm api-key:create -- --merchant <merchant-slug> [--name <label>]",
  );
  process.exit(1);
}

const db = await getDb();
const merchant = await findMerchantBySlug(db, slug);
if (!merchant) {
  console.error(`Merchant not found: ${slug}`);
  process.exit(1);
}

const secret = `ra_${randomSecret(30)}`;
await insertApiKey(db, {
  merchantId: merchant.id,
  name,
  prefix: secret.slice(0, 10),
  keyHash: sha256(secret),
  scopes: ["pos:write"],
  createdBy: null,
});

console.log(`Created ${name} API key for ${merchant.name}.`);
console.log("Copy it now; only its hash is stored:");
console.log(secret);
process.exit(0);
