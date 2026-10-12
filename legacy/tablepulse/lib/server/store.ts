import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { seed } from "../seed";
import type { State } from "../types";
import { demoMode, venueId } from "./config";
import { adminClient } from "./supabase";
const file = path.join(process.cwd(), ".demo", "state.json");
const globalStore = globalThis as typeof globalThis & {
  tablepulseQueue?: Promise<unknown>;
};
const upgrade = (state: State) => {
  state.settings.minMarginPercent ??= 30;
  return state;
};
export async function readState(): Promise<State> {
  if (!demoMode) {
    const { data, error } = await adminClient().rpc("tablepulse_snapshot", {
      p_venue: venueId,
    });
    if (error) throw new Error(error.message);
    return upgrade(data as State);
  }
  try {
    return upgrade(JSON.parse(await fs.readFile(file, "utf8")) as State);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const state = seed();
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(file, JSON.stringify(state), { flag: "wx" });
      return upgrade(state);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        return upgrade(JSON.parse(await fs.readFile(file, "utf8")) as State);
      throw e;
    }
  }
}
async function writeDemo(state: State) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(state));
  await fs.rename(`${file}.tmp`, file);
}
export async function transact<T>(
  fn: (state: State) => T | Promise<T>,
): Promise<T> {
  if (demoMode) {
    const operation = (globalStore.tablepulseQueue ?? Promise.resolve()).then(
      async () => {
        const state = await readState();
        const result = await fn(state);
        state.revision++;
        await writeDemo(state);
        return result;
      },
    );
    globalStore.tablepulseQueue = operation.catch(() => {});
    return operation;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await readState();
    const result = await fn(state);
    const { error } = await adminClient().rpc("tablepulse_commit", {
      p_venue: venueId,
      p_revision: state.revision,
      p_state: state,
    });
    if (!error) return result;
    if (error.code !== "40001") throw new Error(error.message);
  }
  throw new Error("Service is busy. Please retry.");
}
export async function resetDemo() {
  if (!demoMode) throw new Error("Reset is only available in demo mode");
  return transact((state) => {
    Object.assign(state, seed(), { demoOtps: [], memberCheckins: [] });
    return { ok: true };
  });
}
