import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchInboundToFlows } from "./engine";
import { supabaseAdmin } from "./admin-client";
import { flowSendText } from "./channel-send";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./appointments", () => ({
  bookFlowAppointment: vi.fn().mockResolvedValue({
    ok: true, appointmentId: "appointment-123", startsAt: "2035-01-01T18:00:00Z",
  }),
  loadOfferedSlots: vi.fn(),
  slotsVarKey: (key: string) => `__slots_${key}`,
}));
vi.mock("./channel-send", () => ({
  flowSendText: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendButtons: vi.fn(),
  flowSendList: vi.fn(),
  flowSendMedia: vi.fn(),
  matchNumberedOption: vi.fn(),
}));

describe("appointment reference in flows", () => {
  beforeEach(() => vi.clearAllMocks());

  async function runFlow(referenceKey: string | undefined, failReferenceSave = false) {
    const writes: { table: string; body: Record<string, unknown> }[] = [];
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "question", vars: { slot: "2035-01-01T18:00:00Z" },
      reprompt_count: 0,
    };
    const nodes = [
      { node_key: "question", node_type: "collect_input", config: { var_key: "name", next_node_key: "book" } },
      { node_key: "book", node_type: "book_appointment", config: {
        slot_var_key: "slot", title: "Reserva", reference_var_key: referenceKey, next_node_key: "confirmation",
      } },
      { node_key: "confirmation", node_type: "send_message", config: { text: "Referencia: {{vars.ref}}", next_node_key: "end" } },
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
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push({ table, body });
          if (table === "flow_runs" && url.searchParams.has("select")) {
            if (failReferenceSave) return Response.json({ message: "write failed" }, { status: 500 });
            return Response.json([{ id: "run" }]);
          }
          return new Response(null, { status: 204 });
        }
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      isFirstInboundMessage: false,
      message: { kind: "text", text: "Ana", meta_message_id: "incoming" },
    });
    return { result, writes };
  }

  it("persists the reference before interpolating the confirmation", async () => {
    const { result, writes } = await runFlow("ref");
    expect(result.outcome).toBe("completed");
    expect(writes).toContainEqual(expect.objectContaining({
      table: "flow_runs", body: { vars: { slot: "2035-01-01T18:00:00Z", name: "Ana", ref: "appointment-123" } },
    }));
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Referencia: appointment-123" }));
  });

  it("does not send a confirmation when reference persistence fails", async () => {
    const { result, writes } = await runFlow("ref", true);
    expect(result.outcome).toBe("handed_off");
    expect(flowSendText).not.toHaveBeenCalled();
    expect(writes).toContainEqual(expect.objectContaining({
      table: "conversations", body: expect.objectContaining({ status: "pending" }),
    }));
  });

  it("preserves booking behavior when no reference variable is configured", async () => {
    const { result } = await runFlow(undefined);
    expect(result.outcome).toBe("completed");
    expect(flowSendText).toHaveBeenCalledOnce();
  });
});
