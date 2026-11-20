import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "./admin-client";
import { bookFlowAppointment, loadOfferedSlots } from "./appointments";
import { dispatchInboundToFlows } from "./engine";
import { flowSendButtons, flowSendText } from "./channel-send";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./appointments", async (importOriginal) => ({
  ...await importOriginal<typeof import("./appointments")>(),
  loadOfferedSlots: vi.fn(),
  bookFlowAppointment: vi.fn(),
  slotsVarKey: (key: string) => `__slots_${key}`,
  offerTokenVarKey: (key: string) => `__offer_token_${key}`,
}));
vi.mock("./channel-send", () => ({
  flowSendText: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendButtons: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendList: vi.fn(),
  flowSendMedia: vi.fn(),
  matchNumberedOption: vi.fn(),
}));

describe("requested-date offer handling", () => {
  afterEach(() => vi.clearAllMocks());

  async function runOffer(failOfferSave = false, guarded = false) {
    const writes: { table: string; body: Record<string, unknown> }[] = [];
    const steps: string[] = [];
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "date", vars: guarded ? { __guarded_appointments: true } : {}, reprompt_count: 0,
    };
    const nodes = [
      { node_key: "date", node_type: "collect_input", config: { var_key: "fecha", next_node_key: "offer" } },
      { node_key: "offer", node_type: "offer_slots", config: {
        text: "Horarios", date_var_key: "fecha", var_key: "slot",
        next_node_key: guarded ? "book" : "end", no_availability_next: "unavailable",
      } },
      ...(guarded ? [{ node_key: "book", node_type: "book_appointment", config: { idempotent_booking: true } }] : []),
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
        if (table === "update_flow_run_vars_if_current") {
          const args = JSON.parse(String(init?.body)) as { p_new_vars: Record<string, unknown>; p_reset_reprompts: boolean };
          writes.push({ table: "flow_runs", body: { vars: args.p_new_vars, ...(args.p_reset_reprompts ? { reprompt_count: 0 } : {}) } });
          if (failOfferSave && "__offer_token_offer" in args.p_new_vars) return Response.json({ message: "write failed" }, { status: 500 });
          return Response.json(true);
        }
        if (table === "prepare_guarded_appointment_offer") {
          steps.push("prepare");
          const args = JSON.parse(String(init?.body)) as { p_new_vars: Record<string, unknown> };
          writes.push({ table: "flow_runs", body: { vars: args.p_new_vars } });
          return failOfferSave ? Response.json({ message: "write failed" }, { status: 500 }) : Response.json(true);
        }
        if (init?.body) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push({ table, body });
          if (table === "flow_runs" && url.searchParams.has("select")) {
            if (failOfferSave && typeof body.vars === "object" && body.vars !== null && "__slots_offer" in body.vars) {
              return Response.json({ message: "write failed" }, { status: 500 });
            }
            return Response.json([{ id: "run" }]);
          }
          return new Response(null, { status: 204 });
        }
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    if (guarded) vi.mocked(flowSendText).mockImplementationOnce(async () => {
      steps.push("send");
      return { message_id: "sent" };
    });
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      isFirstInboundMessage: false,
      message: { kind: "text", text: "21/11/2026", meta_message_id: "incoming" },
    });

    return { result, writes, steps };
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

  it("persists the available slots before sending the offer", async () => {
    vi.mocked(loadOfferedSlots).mockResolvedValue({
      hasSchedule: true,
      slots: [{ id: "slot_1", title: "18:00", start: "2035-01-01T18:00:00Z", end: "2035-01-01T18:30:00Z" }],
    });
    const { result, writes } = await runOffer();
    expect(result.outcome).toBe("advanced");
    expect(writes).toContainEqual(expect.objectContaining({
      table: "flow_runs",
      body: expect.objectContaining({ vars: expect.objectContaining({
        __slots_offer: expect.any(Array),
      }) }),
    }));
    expect(flowSendButtons).toHaveBeenCalledOnce();
  });

  it("hands off without sending slots if the offer cannot be saved", async () => {
    vi.mocked(loadOfferedSlots).mockResolvedValue({
      hasSchedule: true,
      slots: [{ id: "slot_1", title: "18:00", start: "2035-01-01T18:00:00Z", end: "2035-01-01T18:30:00Z" }],
    });
    const { result } = await runOffer(true);
    expect(result.outcome).toBe("handed_off");
    expect(flowSendButtons).not.toHaveBeenCalled();
  });

  it("sends a protected offer with its saved code as text", async () => {
    vi.mocked(loadOfferedSlots).mockResolvedValue({
      hasSchedule: true,
      slots: [{ id: "slot_1", title: "18:00", start: "2035-01-01T18:00:00Z", end: "2035-01-01T18:30:00Z" }],
    });
    const { result, writes, steps } = await runOffer(false, true);
    expect(result.outcome).toBe("advanced");
    const offer = writes.find((write) => write.table === "flow_runs"
      && typeof write.body.vars === "object" && write.body.vars !== null && "__offer_token_offer" in write.body.vars);
    const vars = offer?.body.vars as Record<string, unknown> | undefined;
    expect(typeof vars?.__offer_token_offer).toBe("string");
    const code = String(vars?.__offer_token_offer).replaceAll("-", "").slice(0, 12).toUpperCase();
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining(`1. 18:00 (${code})`) }));
    expect(flowSendButtons).not.toHaveBeenCalled();
    expect(steps).toEqual(["prepare", "send"]);
    expect(vars?.__offer_pending_offer).toBe(vars?.__offer_token_offer);
    const recorded = writes.find((write) => write.table === "flow_runs"
      && typeof write.body.vars === "object" && write.body.vars !== null
      && "__offer_token_offer" in write.body.vars && !("__offer_pending_offer" in write.body.vars));
    expect(recorded).toBeDefined();
  });

  it.each([false, true])("accepts a selection before offer send returns, send fails: %s", async (sendFails) => {
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "date", vars: { __guarded_appointments: true } as Record<string, unknown>, reprompt_count: 0,
    };
    const nodes = [
      { node_key: "date", node_type: "collect_input", config: { var_key: "fecha", next_node_key: "offer" } },
      { node_key: "offer", node_type: "offer_slots", config: {
        text: "Horarios", date_var_key: "fecha", var_key: "slot", next_node_key: "book",
      } },
      { node_key: "book", node_type: "book_appointment", config: { slot_var_key: "slot", idempotent_booking: true, next_node_key: "end" } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop();
        if (table === "flow_runs" && init?.method === "GET") return Response.json([{ ...run }]);
        if (table === "flow_nodes" && init?.method === "GET") return Response.json(nodes);
        if (table === "flow_run_events" && init?.method === "HEAD") {
          return new Response(null, { headers: { "content-range": "*/0" } });
        }
        if (table === "update_flow_run_vars_if_current" || table === "prepare_guarded_appointment_offer") {
          const args = JSON.parse(String(init?.body)) as {
            p_expected_node_key: string; p_expected_vars: Record<string, unknown>;
            p_new_vars: Record<string, unknown>; p_offer_node_key?: string;
          };
          if (run.status !== "active" || args.p_expected_node_key !== run.current_node_key
              || JSON.stringify(args.p_expected_vars) !== JSON.stringify(run.vars)) return Response.json(false);
          run.vars = args.p_new_vars;
          if (args.p_offer_node_key) run.current_node_key = args.p_offer_node_key;
          return Response.json(true);
        }
        if (table === "apply_guarded_offer_fallback") {
          const args = JSON.parse(String(init?.body)) as { p_expected_vars: Record<string, unknown> };
          return Response.json(run.status === "active" && JSON.stringify(args.p_expected_vars) === JSON.stringify(run.vars));
        }
        if (table === "flow_runs" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as { status?: string };
          if (body.status) run.status = body.status;
        }
        if (init?.body) return new Response(null, { status: 204 });
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    vi.mocked(loadOfferedSlots).mockResolvedValue({
      hasSchedule: true,
      slots: [{ id: "slot_1", title: "18:00", start: "2035-01-01T18:00:00Z", end: "2035-01-01T18:30:00Z" }],
    });
    vi.mocked(bookFlowAppointment).mockResolvedValue({ ok: true, appointmentId: "id", startsAt: "2035-01-01T18:00:00Z" });
    let replyOutcome: string | undefined;
    vi.mocked(flowSendText).mockImplementationOnce(async ({ text }) => {
      const code = /\(([0-9A-F]{12})\)/.exec(text)?.[1];
      expect(code).toBeDefined();
      const reply = await dispatchInboundToFlows({
        accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
        isFirstInboundMessage: false, message: { kind: "text", text: `1 ${code}`, meta_message_id: "reply" },
      });
      replyOutcome = reply.outcome;
      if (sendFails) throw new Error("delivery uncertain");
      return { message_id: "sent" };
    });
    await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      isFirstInboundMessage: false, message: { kind: "text", text: "21/11/2026", meta_message_id: "date" },
    });
    expect(replyOutcome).toBe("completed");
    expect(bookFlowAppointment).toHaveBeenCalledOnce();
    expect(run.status).toBe("completed");
  });
});

describe("protected appointment offer", () => {
  afterEach(() => vi.clearAllMocks());

  async function answer(text: string, claimed = false, loseRace = false, options: {
    fallbackResult?: boolean | "error";
    failSelection?: boolean;
    handoffImmediately?: boolean;
    repromptHandoffResult?: boolean;
  } = {}) {
    const token = "abcdef12-3456-7890-abcd-ef1234567890";
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "offer", reprompt_count: 0,
      vars: {
        __guarded_appointments: true,
        __offer_token_offer: token,
        ...(claimed ? { __offer_claim_offer: token } : {}),
        __slots_offer: [{ id: "slot_1", title: "18:00", start: "2035-01-01T18:00:00Z", end: "2035-01-01T18:30:00Z" }],
      },
    };
    const nodes = [
      { node_key: "offer", node_type: "offer_slots", config: { text: "Responde con número y código", var_key: "slot", next_node_key: "book" } },
      { node_key: "book", node_type: "book_appointment", config: { slot_var_key: "slot", idempotent_booking: true, next_node_key: "end" } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    let selectionRequest: Record<string, unknown> | undefined;
    const fallbackRequests: Record<string, unknown>[] = [];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop();
        if (init?.method === "GET" && table === "flow_runs") {
          return Response.json(url.searchParams.get("select") === "id" ? [] : [run]);
        }
        if (init?.method === "GET" && table === "flow_nodes") return Response.json(nodes);
        if (init?.method === "GET" && table === "flows") return Response.json([{ fallback_policy: { on_unknown_reply: options.handoffImmediately ? "handoff" : "reprompt", max_reprompts: 2, on_exhaust: "handoff", on_timeout_hours: 24 } }]);
        if (init?.method === "HEAD" && table === "flow_run_events") {
          return new Response(null, { headers: { "content-range": "*/0" } });
        }
        if (table === "update_flow_run_vars_if_current") {
          selectionRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
          if (options.failSelection) return Response.json({ message: "selection failed" }, { status: 500 });
          return Response.json(!loseRace);
        }
        if (table === "apply_guarded_offer_fallback") {
          const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
          fallbackRequests.push(args);
          if (args.p_reason === "reprompt_failed" && options.repromptHandoffResult !== undefined) {
            return Response.json(options.repromptHandoffResult);
          }
          return options.fallbackResult === "error"
            ? Response.json({ message: "fallback failed" }, { status: 500 })
            : Response.json(options.fallbackResult ?? true);
        }
        if (init?.body) return new Response(null, { status: 204 });
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    vi.mocked(bookFlowAppointment).mockResolvedValue({ ok: true, appointmentId: "id", startsAt: "2035-01-01T18:00:00Z" });
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      isFirstInboundMessage: false, message: { kind: "text", text, meta_message_id: "incoming" },
    });
    return { result, selectionRequest, fallbackRequests };
  }

  it("re-prompts for a code from an older offer without booking", async () => {
    const { result } = await answer("1 ABCDEF123457");
    expect(result.outcome).toBe("fallback_fired");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("(ABCDEF123456)") }));
  });

  it("books only after a conditional selection claim succeeds", async () => {
    const { result, selectionRequest } = await answer("1 ABCDEF123456");
    expect(result.outcome).toBe("completed");
    expect(selectionRequest).toMatchObject({
      p_expected_node_key: "offer", p_expected_vars: { __offer_token_offer: "abcdef12-3456-7890-abcd-ef1234567890" },
    });
    expect(bookFlowAppointment).toHaveBeenCalledOnce();
  });

  it("does not book after losing the selection race or when already claimed", async () => {
    expect((await answer("1 ABCDEF123456", false, true)).result.outcome).toBe("stale_inbound_ignored");
    expect((await answer("1 ABCDEF123456", true)).result.outcome).toBe("stale_inbound_ignored");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("does not hand off when an invalid answer loses to a selection", async () => {
    const { result, fallbackRequests } = await answer("invalid", false, false, {
      fallbackResult: false, handoffImmediately: true,
    });
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(fallbackRequests).toEqual([expect.objectContaining({ p_action: "handoff", p_expected_reprompt_count: 0 })]);
    expect(flowSendText).not.toHaveBeenCalled();
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("reports fallback errors without proceeding", async () => {
    const { result } = await answer("invalid", false, false, { fallbackResult: "error", handoffImmediately: true });
    expect(result.outcome).toBe("processing_failed");
    expect(flowSendText).not.toHaveBeenCalled();
  });

  it("does not overwrite a concurrent selection after an ambiguous capture error", async () => {
    const { result, fallbackRequests } = await answer("1 ABCDEF123456", false, false, {
      failSelection: true, fallbackResult: false,
    });
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(fallbackRequests).toEqual([expect.objectContaining({ p_action: "handoff", p_reason: "selection_failed" })]);
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("does not transfer after a failed reprompt if a selection has since won", async () => {
    vi.mocked(flowSendText).mockRejectedValueOnce(new Error("send failed"));
    const { result, fallbackRequests } = await answer("invalid", false, false, { repromptHandoffResult: false });
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(fallbackRequests).toHaveLength(2);
    expect(fallbackRequests[1]).toMatchObject({
      p_action: "handoff", p_reason: "reprompt_failed", p_expected_reprompt_count: 1,
    });
  });

  it("starts guarded runs only when a protected booking exists in the graph", async () => {
    let inserted: Record<string, unknown> | undefined;
    const nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "end" } },
      { node_key: "end", node_type: "end", config: {} },
      { node_key: "book", node_type: "book_appointment", config: { idempotent_booking: true } },
    ];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const table = new URL(String(input)).pathname.split("/").pop();
        if (table === "flow_runs" && init?.method === "GET") return Response.json([]);
        if (table === "flows" && init?.method === "GET") return Response.json([{
          id: "flow", account_id: "account", user_id: "user", status: "active",
          trigger_type: "keyword", trigger_config: { keywords: ["poc"], match_type: "exact" },
          entry_node_id: "start",
        }]);
        if (table === "flow_nodes" && init?.method === "GET") return Response.json(nodes);
        if (table === "flow_runs" && init?.method === "POST") {
          inserted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ id: "run", reprompt_count: 0, ...inserted });
        }
        if (table === "increment_flow_execution_count") return Response.json(null);
        if (init?.body) return new Response(null, { status: 204 });
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      isFirstInboundMessage: false, message: { kind: "text", text: "poc", meta_message_id: "incoming" },
    });
    expect(result.outcome).toBe("completed");
    expect(inserted?.vars).toEqual({ __guarded_appointments: true });
  });
});
