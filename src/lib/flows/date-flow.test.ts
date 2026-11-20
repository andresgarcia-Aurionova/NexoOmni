import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchInboundToFlows } from "./engine";
import { supabaseAdmin } from "./admin-client";
import { flowSendText } from "./channel-send";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./channel-send", () => ({
  flowSendText: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendButtons: vi.fn(),
  flowSendList: vi.fn(),
  flowSendMedia: vi.fn(),
  matchNumberedOption: vi.fn(),
}));

describe("date capture in a flow", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function reply(text: string, dateNotPast: boolean) {
    const writes: { table: string; body: Record<string, unknown> }[] = [];
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "date", vars: {}, reprompt_count: 0,
    };
    const nodes = [
      { node_key: "date", node_type: "collect_input", config: {
        prompt_text: "Fecha DD/MM/AAAA", var_key: "fecha", next_node_key: "end",
        date_not_past: dateNotPast, date_timezone: "America/Mexico_City",
      } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop() ?? "";
        if (init?.method === "GET" && table === "flow_runs") {
          return Response.json(url.searchParams.get("select") === "id" ? [] : [run]);
        }
        if (init?.method === "GET" && table === "flow_nodes") return Response.json(nodes);
        if (init?.method === "GET" && table === "flows") {
          return Response.json({ fallback_policy: { on_unknown_reply: "reprompt", max_reprompts: 2 } });
        }
        if (init?.method === "HEAD" && table === "flow_run_events") {
          return new Response(null, { headers: { "content-range": "*/0" } });
        }
        if (init?.body) {
          writes.push({ table, body: JSON.parse(String(init.body)) as Record<string, unknown> });
          return new Response(null, { status: 204 });
        }
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      isFirstInboundMessage: false,
      message: { kind: "text", text, meta_message_id: "incoming" },
    });
    return { result, writes };
  }

  it("reprompts without storing a past date", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-20T18:00:00Z"));
    const { result, writes } = await reply("19/11/2026", true);
    expect(result.outcome).toBe("fallback_fired");
    expect(writes.some((write) => write.table === "flow_runs" && "vars" in write.body)).toBe(false);
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Fecha DD/MM/AAAA" }));
  });

  it("captures a valid date and preserves legacy free-text capture", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-20T18:00:00Z"));
    for (const [text, enabled] of [["20/11/2026", true], ["ayer", false]] as const) {
      const { result, writes } = await reply(text, enabled);
      expect(result.outcome).toBe("completed");
      expect(writes).toContainEqual(expect.objectContaining({
        table: "flow_runs", body: { vars: { fecha: text }, reprompt_count: 0 },
      }));
    }
  });
});
