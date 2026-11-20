import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "./admin-client";
import { loadOfferedSlots } from "./appointments";
import { dispatchInboundToFlows } from "./engine";
import { flowSendText } from "./channel-send";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./appointments", () => ({
  loadOfferedSlots: vi.fn(),
  bookFlowAppointment: vi.fn(),
  slotsVarKey: (key: string) => `__slots_${key}`,
}));
vi.mock("./channel-send", () => ({
  flowSendText: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendButtons: vi.fn(),
  flowSendList: vi.fn(),
  flowSendMedia: vi.fn(),
  matchNumberedOption: vi.fn(),
}));

describe("requested-date offer handling", () => {
  afterEach(() => vi.clearAllMocks());

  async function runOffer() {
    const writes: { table: string; body: Record<string, unknown> }[] = [];
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "date", vars: {}, reprompt_count: 0,
    };
    const nodes = [
      { node_key: "date", node_type: "collect_input", config: { var_key: "fecha", next_node_key: "offer" } },
      { node_key: "offer", node_type: "offer_slots", config: {
        text: "Horarios", date_var_key: "fecha", var_key: "slot",
        next_node_key: "end", no_availability_next: "unavailable",
      } },
      { node_key: "unavailable", node_type: "send_message", config: { text: "Sin horarios", next_node_key: "end" } },
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
      message: { kind: "text", text: "21/11/2026", meta_message_id: "incoming" },
    });
    return { result, writes };
  }

  it("uses the configured no-availability path for an empty requested day", async () => {
    vi.mocked(loadOfferedSlots).mockResolvedValue({ slots: [], hasSchedule: true });
    const { result } = await runOffer();
    expect(result.outcome).toBe("completed");
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Sin horarios" }));
    expect(loadOfferedSlots).toHaveBeenCalledWith(
      expect.anything(), "account", expect.objectContaining({ date_var_key: "fecha" }), { fecha: "21/11/2026" },
    );
  });

  it("hands off instead of claiming no availability when the date is invalid", async () => {
    vi.mocked(loadOfferedSlots).mockResolvedValue({ slots: [], hasSchedule: true, invalidPreference: true });
    const { result, writes } = await runOffer();
    expect(result.outcome).toBe("handed_off");
    expect(flowSendText).not.toHaveBeenCalled();
    expect(writes).toContainEqual(expect.objectContaining({
      table: "conversations", body: expect.objectContaining({ status: "pending" }),
    }));
  });
});
