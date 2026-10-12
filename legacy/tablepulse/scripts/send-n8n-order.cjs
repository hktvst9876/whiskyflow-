// Sends a user-selected event file to a configured n8n webhook. No random retry IDs.
const fs = require("node:fs");
async function main() {
  const url = process.env.TABLEPULSE_N8N_WEBHOOK_URL;
  const key = process.env.TABLEPULSE_POS_INGRESS_KEY;
  const file = process.argv[2];
  if (!url || !key || !file)
    throw new Error(
      "Set TABLEPULSE_N8N_WEBHOOK_URL, TABLEPULSE_POS_INGRESS_KEY, and pass an order JSON file.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  )
    throw new Error("Use HTTPS, or HTTP only for a local loopback test.");
  const event = JSON.parse(fs.readFileSync(file, "utf8"));
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(45000),
    headers: {
      "Content-Type": "application/json",
      "x-tablepulse-pos-key": key,
    },
    body: JSON.stringify(event),
  });
  console.log(response.status, await response.text());
  if (!response.ok) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
