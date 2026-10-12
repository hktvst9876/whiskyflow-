"use client";
import { useEffect, useRef } from "react";
import type { Snapshot } from "@/lib/types";
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
export function useVenueTools(data: Snapshot) {
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    const context = (document as ModelDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: "read_service_overview",
            title: "Read service overview",
            description:
              "Read current venue table counts, reward counts and recorded reward financial totals. Does not include customer profiles or screen tokens.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: (input) => {
              if (
                !input ||
                typeof input !== "object" ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error("Expected an empty object");
              const s = latest.current;
              return {
                venue: s.venue.name,
                activeTables: s.sessions.filter((x) => !x.closedAt).length,
                activeRewards: s.instances.filter(
                  (x) =>
                    x.status === "active" &&
                    Date.parse(x.expiresAt) > Date.now(),
                ).length,
                redemptions: s.redemptions.length,
                revenue: s.redemptions.reduce((n, r) => n + r.revenue, 0),
                estimatedProfit: s.redemptions.reduce(
                  (n, r) => n + r.profit,
                  0,
                ),
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional proposed API; conventional controls stay available. */
    }
    return () => lifecycle.abort();
  }, []);
}
