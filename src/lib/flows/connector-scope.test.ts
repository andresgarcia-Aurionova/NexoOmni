import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "./admin-client";
import { dispatchInboundToFlows } from "./engine";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));

describe("starting a flow on a connected line", () => {
  afterEach(() => vi.clearAllMocks());

  async function dispatch(actualLine: string | null, configuredLine: string | undefined) {
    const calls: string[] = [];
    const flow = {
      id: "flow", account_id: "account", user_id: "owner", entry_node_id: "end",
      trigger_type: "keyword", trigger_config: {
        keywords: ["start"], match_type: "exact",
        ...(configuredLine === undefined ? {} : { connector_id: configuredLine }),
      },
    };
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop() ?? "";
        const method = init?.method ?? "GET";
        calls.push(`${method} ${table}`);
        if (table === "flow_runs" && method === "GET") return Response.json([]);
        if (table === "flows" && method === "GET") return Response.json([flow]);
        if (table === "conversations" && method === "GET") {
          expect(url.searchParams.get("account_id")).toBe("eq.account");
          expect(url.searchParams.get("id")).toBe("eq.conversation");
          return Response.json([{ connector_id: actualLine }]);
        }
        if (table === "flow_nodes" && method === "GET") return Response.json([{ node_key: "end", node_type: "end", config: {} }]);
        if (table === "flow_runs" && method === "POST") return Response.json([{
          id: "run", flow_id: "flow", account_id: "account", user_id: "owner",
          contact_id: "contact", conversation_id: "conversation", current_node_key: "end", vars: {},
        }]);
        if (method === "POST" || method === "PATCH") return new Response(null, { status: 204 });
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "owner", contactId: "contact", conversationId: "conversation",
      channelType: "zernio_whatsapp", isFirstInboundMessage: false,
      message: { kind: "text", text: "start", meta_message_id: "incoming" },
    });
    return { result, calls };
  }

  it("starts only on the configured line", async () => {
    expect((await dispatch("line-a", "line-a")).result.consumed).toBe(true);
    for (const otherLine of ["line-b", null]) {
      const { result, calls } = await dispatch(otherLine, "line-a");
      expect(result.consumed).toBe(false);
      expect(calls).not.toContain("POST flow_runs");
    }
  });

  it("does not need a connector lookup for legacy unscoped flows", async () => {
    const { result, calls } = await dispatch(null, undefined);
    expect(result.consumed).toBe(true);
    expect(calls).not.toContain("GET conversations");
  });
});
