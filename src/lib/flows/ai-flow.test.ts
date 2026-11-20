import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "./admin-client";
import { decideFlowAiTurn } from "./ai-assist";
import { flowSendText } from "./channel-send";
import { dispatchInboundToFlows } from "./engine";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./ai-assist", () => ({ decideFlowAiTurn: vi.fn() }));
vi.mock("./channel-send", () => ({
  flowSendText: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendButtons: vi.fn(), flowSendList: vi.fn(), flowSendMedia: vi.fn(),
  matchNumberedOption: vi.fn(),
}));

describe("AI inside an active flow", () => {
  afterEach(() => vi.resetAllMocks());

  async function dispatch(claimOutcome = "claimed", active = true) {
    const calls: string[] = [];
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "menu", vars: { __flow_ai_enabled: true }, reprompt_count: 0,
    };
    const nodes = [
      { node_key: "menu", node_type: "send_buttons", config: {
        ai_assist: true, text: "¿Qué necesitas?",
        buttons: [{ reply_id: "book", title: "Reservar", next_node_key: "end" }],
      } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop() ?? "";
        calls.push(table);
        if (table === "flow_runs" && init?.method === "GET") {
          return Response.json(url.searchParams.get("select") === "id" ? [] : [run]);
        }
        if (table === "flow_nodes") return Response.json(nodes);
        if (table === "flow_run_events" && init?.method === "HEAD") {
          return new Response(null, { headers: { "content-range": "*/0" } });
        }
        if (table === "claim_flow_ai_turn") {
          return Response.json([{ outcome: claimOutcome, turn_id: "turn", turn_node_key: "menu" }]);
        }
        if (table === "is_flow_ai_turn_active") return Response.json(active);
        if (table === "finish_flow_ai_turn" || table === "handoff_flow_ai_turn") return Response.json(true);
        if (init?.body) return new Response(null, { status: 204 });
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      channelType: "zernio_whatsapp", isFirstInboundMessage: false,
      message: { kind: "text", text: "quiero reservar", meta_message_id: "message" },
    });
    return { result, calls };
  }

  it("routes an interpreted reply through the existing graph", async () => {
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "book" });
    const { result, calls } = await dispatch();
    expect(result.outcome).toBe("completed");
    expect(calls).toContain("finish_flow_ai_turn");
  });

  it("hands off a concurrent message without calling the model again", async () => {
    const { result, calls } = await dispatch("handed_off");
    expect(result.outcome).toBe("handed_off");
    expect(calls).not.toContain("handoff_flow_ai_turn");
    expect(decideFlowAiTurn).not.toHaveBeenCalled();
  });

  it("does not send an answer if the run was handed off during generation", async () => {
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "answer", text: "Información autorizada." });
    const { result } = await dispatch("claimed", false);
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(flowSendText).not.toHaveBeenCalled();
  });

  it("sends an authorized answer and keeps the flow at the menu", async () => {
    vi.mocked(flowSendText).mockResolvedValue({ message_id: "sent" });
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "answer", text: "Información autorizada." });
    const { result, calls } = await dispatch();
    expect(result.outcome).toBe("advanced");
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Información autorizada." }));
    expect(calls).toContain("finish_flow_ai_turn");
  });

  it("hands off if AI generation or billing fails", async () => {
    vi.mocked(decideFlowAiTurn).mockRejectedValue(new Error("AI unavailable"));
    const { result, calls } = await dispatch();
    expect(result.outcome).toBe("handed_off");
    expect(calls).toContain("handoff_flow_ai_turn");
  });
});
