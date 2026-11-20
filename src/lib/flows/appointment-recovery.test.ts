import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/flows/cron/route";
import { supabaseAdmin } from "./admin-client";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));

describe("stalled appointment recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("hands off interrupted AI turns and reports recovery failures", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2035-01-01T18:05:00Z"));
    vi.stubEnv("AUTOMATION_CRON_SECRET", "test-secret");
    const calls: Record<string, unknown>[] = [];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const table = new URL(String(input)).pathname.split("/").pop();
        if (table === "flow_ai_turns") return Response.json([
          { id: "turn", flow_run_id: "run", node_key: "menu", flow_runs: { account_id: "account", status: "active" } },
        ]);
        if (table === "handoff_flow_ai_turn") {
          calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json(true);
        }
        if (table === "flow_runs") return Response.json([]);
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const response = await GET(new Request("https://example.test/api/flows/cron", {
      headers: { "x-cron-secret": "test-secret" },
    }));
    expect(await response.json()).toMatchObject({ aiHandedOff: 1, aiRecoveryFailures: 0 });
    expect(calls).toEqual([expect.objectContaining({ p_run_id: "run", p_turn_id: "turn", p_stalled_only: true })]);
  });

  it.each(["success", "failed", "changed"] as const)("handles an overdue claim without timing it out: %s", async (result) => {
    vi.useFakeTimers().setSystemTime(new Date("2035-01-01T18:05:00Z"));
    vi.stubEnv("AUTOMATION_CRON_SECRET", "test-secret");
    const calls: Record<string, unknown>[] = [];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const table = new URL(String(input)).pathname.split("/").pop();
        if (table === "flow_ai_turns") return Response.json([]);
        if (table === "flow_runs" && init?.method !== "PATCH") return Response.json([{
          id: "run", flow_id: "flow", user_id: "user", contact_id: "contact",
          current_node_key: "offer", last_advanced_at: "2035-01-01T18:00:00Z",
          vars: { __guarded_appointments: true, __offer_token_offer: "token", __offer_claim_offer: "token" },
          flows: { fallback_policy: { on_timeout_hours: 0.01 } },
        }]);
        if (table === "handoff_stalled_flow_appointment") {
          calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return result === "failed" ? Response.json({ message: "recovery failed" }, { status: 500 }) : Response.json(result === "success");
        }
        if (table === "flow_runs") throw new Error("Claim must not be timed out");
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const response = await GET(new Request("https://example.test/api/flows/cron", {
      headers: { "x-cron-secret": "test-secret" },
    }));
    expect(response.status).toBe(result === "failed" ? 500 : 200);
    expect(await response.json()).toMatchObject({ swept: 0, handedOff: result === "success" ? 1 : 0, recoveryFailures: result === "failed" ? 1 : 0 });
    expect(calls).toEqual([expect.objectContaining({ p_run_id: "run", p_expected_offer_token: "token" })]);
  });

  it("recovers an offer whose send was interrupted", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2035-01-01T18:05:00Z"));
    vi.stubEnv("AUTOMATION_CRON_SECRET", "test-secret");
    const calls: Record<string, unknown>[] = [];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const table = new URL(String(input)).pathname.split("/").pop();
        if (table === "flow_ai_turns") return Response.json([]);
        if (table === "flow_runs") return Response.json([{
          id: "run", current_node_key: "offer", last_advanced_at: "2035-01-01T18:00:00Z",
          vars: { __guarded_appointments: true, __offer_token_offer: "token", __offer_pending_offer: "token" },
          flows: { fallback_policy: null },
        }]);
        if (table === "handoff_stalled_flow_appointment") {
          calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json(true);
        }
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const response = await GET(new Request("https://example.test/api/flows/cron", {
      headers: { "x-cron-secret": "test-secret" },
    }));
    expect(await response.json()).toMatchObject({ handedOff: 1 });
    expect(calls).toEqual([expect.objectContaining({ p_run_id: "run", p_expected_offer_token: "token" })]);
  });

  it("only times out the run if it has not advanced since the scan", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2035-01-02T18:05:00Z"));
    vi.stubEnv("AUTOMATION_CRON_SECRET", "test-secret");
    let updateUrl: URL | undefined;
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/flow_ai_turns")) return Response.json([]);
        if (url.pathname.endsWith("/flow_runs") && init?.method === "PATCH") {
          updateUrl = url;
          return Response.json([]);
        }
        if (url.pathname.endsWith("/flow_runs")) return Response.json([{
          id: "run", current_node_key: "offer", vars: {},
          last_advanced_at: "2035-01-01T18:00:00Z", flows: { fallback_policy: null },
        }]);
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const response = await GET(new Request("https://example.test/api/flows/cron", {
      headers: { "x-cron-secret": "test-secret" },
    }));
    expect(await response.json()).toMatchObject({ swept: 0 });
    expect(updateUrl?.searchParams.get("last_advanced_at")).toBe("eq.2035-01-01T18:00:00Z");
  });
});
