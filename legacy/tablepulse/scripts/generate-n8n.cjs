// Generates an inactive, credential-free import from reviewed Code node sources.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "integrations", "n8n");
const code = (name) =>
  fs.readFileSync(path.join(root, "code", name + ".js"), "utf8");
const node = (
  id,
  name,
  type,
  typeVersion,
  position,
  parameters,
  extra = {},
) => ({
  id,
  name,
  type: "n8n-nodes-base." + type,
  typeVersion,
  position,
  parameters,
  ...extra,
});
const edge = (node) => ({ node, type: "main", index: 0 });
const fail = { onError: "continueErrorOutput" };
const nodes = [
  node(
    "pos",
    "POS order webhook",
    "webhook",
    2,
    [0, 200],
    {
      httpMethod: "POST",
      path: "tablepulse-pos-order",
      authentication: "headerAuth",
      responseMode: "responseNode",
      options: {},
    },
    {
      webhookId: "tablepulse-pos-order-v1",
      notes:
        "Select a Header Auth credential: x-tablepulse-pos-key. Only the trusted POS/adapter may call this webhook. Publish after testing.",
    },
  ),
  node(
    "validate",
    "Validate order",
    "code",
    2,
    [240, 200],
    {
      mode: "runOnceForAllItems",
      jsCode: code("validate-order"),
    },
    fail,
  ),
  node("valid", "Valid event?", "if", 2.2, [480, 200], {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: "",
        typeValidation: "strict",
        version: 2,
      },
      conditions: [
        {
          id: "valid-boolean",
          leftValue: "={{ $json.valid }}",
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  }),
  node(
    "sign",
    "Sign TablePulse request",
    "crypto",
    2,
    [720, 100],
    {
      action: "hmac",
      type: "SHA256",
      binaryData: false,
      value: "={{ $json.timestamp + '.' + $json.rawBody }}",
      dataPropertyName: "signature",
      encoding: "hex",
    },
    {
      ...fail,
      notes:
        "Select a Crypto credential with Hmac Secret equal to TABLEPULSE_WEBHOOK_SECRET on the backend. Keep the secret in credentials, never in this workflow.",
    },
  ),
  node(
    "evaluate",
    "Record order and evaluate",
    "httpRequest",
    4.2,
    [960, 100],
    {
      method: "POST",
      url: "https://tablepulse.example.com/api/offers/evaluate",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-tablepulse-timestamp", value: "={{ $json.timestamp }}" },
          { name: "x-tablepulse-signature", value: "={{ $json.signature }}" },
        ],
      },
      sendBody: true,
      contentType: "raw",
      rawContentType: "application/json",
      body: "={{ $json.rawBody }}",
      options: {
        timeout: 10000,
        redirect: { redirect: { followRedirects: false } },
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
      },
    },
    {
      ...fail,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 1000,
      notes:
        "Replace the fixed URL with your TablePulse backend. This endpoint BOTH records this new order AND evaluates it. Do not call /api/pos/events first. HTTP errors are classified; only transport/parse errors use node retries.",
    },
  ),
  node(
    "classify",
    "Classify backend result",
    "code",
    2,
    [1200, 100],
    {
      mode: "runOnceForAllItems",
      jsCode: code("classify-response"),
    },
    fail,
  ),
  node("reply", "Reply to POS", "respondToWebhook", 1.4, [1460, 200], {
    respondWith: "json",
    responseBody: "={{ $json.response }}",
    options: {
      responseCode: "={{ $json.statusCode }}",
      responseHeaders: {
        entries: [{ name: "Cache-Control", value: "no-store" }],
      },
    },
  }),
  node("error", "Safe service error", "code", 2, [960, 480], {
    mode: "runOnceForAllItems",
    jsCode: code("service-error"),
  }),
  node("notes", "Setup and boundaries", "stickyNote", 1, [0, -260], {
    width: 650,
    height: 300,
    content:
      "## TablePulse · POS to agentic deal decision\n1. Select Header Auth on the webhook and Crypto credentials on the signer.\n2. Set the fixed HTTPS TablePulse URL in the HTTP node.\n3. Send canonical NEW order lines, not the whole cumulative bill.\n4. Same externalId + identical order for retries.\n\nTablePulse owns hard rules, fixed margin goals, the optional AI ranker, database, caps, inventory and screen updates. Shown/withheld/control are all successful processing. The workflow is imported inactive and stores no execution payloads by default. See integrations/n8n/README.md.",
  }),
];
const workflow = {
  name: "TablePulse — secure POS order and agentic deal decision",
  active: false,
  nodes,
  connections: {
    "POS order webhook": { main: [[edge("Validate order")]] },
    "Validate order": {
      main: [[edge("Valid event?")], [edge("Safe service error")]],
    },
    "Valid event?": {
      main: [[edge("Sign TablePulse request")], [edge("Reply to POS")]],
    },
    "Sign TablePulse request": {
      main: [[edge("Record order and evaluate")], [edge("Safe service error")]],
    },
    "Record order and evaluate": {
      main: [[edge("Classify backend result")], [edge("Safe service error")]],
    },
    "Classify backend result": {
      main: [[edge("Reply to POS")], [edge("Safe service error")]],
    },
    "Safe service error": { main: [[edge("Reply to POS")]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Asia/Singapore",
    saveDataErrorExecution: "none",
    saveDataSuccessExecution: "none",
    saveManualExecutions: false,
    saveExecutionProgress: false,
  },
  pinData: {},
  tags: [],
};
fs.writeFileSync(
  path.join(root, "tablepulse-pos-decision.json"),
  JSON.stringify(workflow, null, 2) + "\n",
);
console.log(
  "Generated integrations/n8n/tablepulse-pos-decision.json (inactive; credentials must be selected).",
);
