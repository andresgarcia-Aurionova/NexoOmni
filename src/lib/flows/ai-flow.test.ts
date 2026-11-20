import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "./admin-client";
import { classifyFlowSentiment, decideFlowAiInput, decideFlowAiTurn } from "./ai-assist";
import { flowSendText } from "./channel-send";
import { dispatchInboundToFlows } from "./engine";
import { bookFlowAppointment } from "./appointments";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./ai-assist", () => ({ decideFlowAiTurn: vi.fn(), decideFlowAiInput: vi.fn(), classifyFlowSentiment: vi.fn() }));
vi.mock("./appointments", async (importOriginal) => ({
  ...await importOriginal<typeof import("./appointments")>(),
  bookFlowAppointment: vi.fn(),
}));
vi.mock("./channel-send", () => ({
  flowSendText: vi.fn().mockResolvedValue({ message_id: "sent" }),
  flowSendButtons: vi.fn(), flowSendList: vi.fn(), flowSendMedia: vi.fn(),
  matchNumberedOption: vi.fn(),
}));

describe("AI inside an active flow", () => {
  let analysisEnabled = false;
  afterEach(() => {
    analysisEnabled = false;
    vi.resetAllMocks();
  });

  async function dispatch(claimOutcome = "claimed", active = true, collect = false, fallbackActive = true, menuDate = false, sentiment = false, saveSuccess = true, image = false, captureFormat?: string, text = "quiero reservar", saveHandoffNote = false) {
    const calls: string[] = [];
    const writes: Record<string, unknown>[] = [];
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: collect ? "date" : "menu",
      vars: { __flow_ai_enabled: true, ...(menuDate ? { __guarded_appointments: true } : {}) }, reprompt_count: 0,
    };
    const nodes = collect ? [
      { node_key: "date", node_type: "collect_input", config: {
        ai_assist: true, prompt_text: "Fecha", invalid_input_text: "Elige una fecha válida de hoy en adelante.",
        var_key: sentiment ? "comentario" : "fecha",
        ...(image ? { var_key: "ticket", accept_image: true } : {}),
        ...(captureFormat ? { var_key: "value", capture_format: captureFormat } : {}),
        ...(sentiment ? { ai_sentiment_var_key: "sentiment" } : !captureFormat && !image ? { date_not_past: true, date_timezone: "America/Mexico_City" } : {}),
        next_node_key: sentiment ? "sentiment_check" : "end",
      } },
      ...(sentiment ? [
        { node_key: "sentiment_check", node_type: "condition", config: {
          subject: "var", subject_key: "sentiment", operator: "equals",
          value: "negative", true_next: "human", false_next: "end",
        } },
        { node_key: "human", node_type: "handoff", config: saveHandoffNote
          ? { note: "Comentario: {{vars.comentario}}", save_note_to_conversation: true }
          : {} },
      ] : []),
      { node_key: "end", node_type: "end", config: {} },
    ] : [
      { node_key: "menu", node_type: "send_buttons", config: {
        ai_assist: true, ai_capture_next_date: menuDate, text: "¿Qué necesitas?",
        buttons: [{ reply_id: "book", title: "Reservar", next_node_key: menuDate ? "date" : "end" }],
      } },
      ...(menuDate ? [{ node_key: "date", node_type: "collect_input", config: {
        ai_assist: true, prompt_text: "Fecha", var_key: "fecha", date_not_past: true,
        date_timezone: "America/Mexico_City", next_node_key: "end",
      } }] : []),
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
        if (table === "flows") return Response.json({ fallback_policy: { on_unknown_reply: "reprompt", max_reprompts: 2 } });
        if (table === "ai_configs") return Response.json({
          conversation_analysis_enabled: analysisEnabled,
          analysis_on_transfer: analysisEnabled,
        });
        if (table === "flow_run_events" && init?.method === "HEAD") {
          return new Response(null, { headers: { "content-range": "*/0" } });
        }
        if (table === "claim_flow_ai_turn") {
          return Response.json([{ outcome: claimOutcome, turn_id: "turn", turn_node_key: run.current_node_key }]);
        }
        if (table === "is_flow_ai_turn_active") return Response.json(active);
        if (table === "finish_flow_ai_turn") return Response.json(true);
        if (table === "handoff_flow_ai_turn") return Response.json(fallbackActive);
        if (table === "queue_ai_analysis_job") return Response.json(null);
        if (table === "update_flow_run_vars_if_current") {
          writes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json(saveSuccess);
        }
        if (init?.body) {
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          if (table === "flow_runs" && url.searchParams.has("select")) {
            return Response.json(fallbackActive ? [{ id: "run" }] : []);
          }
          return new Response(null, { status: 204 });
        }
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    const result = await dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      channelType: "zernio_whatsapp", isFirstInboundMessage: false,
      message: image
        ? { kind: "image", meta_message_id: "message" }
        : { kind: "text", text, meta_message_id: "message" },
    });

    return { result, calls, writes };
  }

  it("routes an interpreted reply through the existing graph", async () => {
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "book" });
    const { result, calls } = await dispatch();
    expect(result.outcome).toBe("completed");
    expect(calls).toContain("finish_flow_ai_turn");
  });

  it("persists a comment and its sentiment together before advancing", async () => {
    vi.mocked(classifyFlowSentiment).mockResolvedValue("negative");
    const { result, writes } = await dispatch("claimed", true, true, true, false, true);
    expect(result.outcome).toBe("handed_off");
    expect(writes).toContainEqual(expect.objectContaining({
      p_new_vars: expect.objectContaining({ comentario: "quiero reservar", sentiment: "negative" }),
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      node_key: "sentiment_check",
      payload: expect.objectContaining({ condition_result: "true", advancing_to: "human" }),
    }));
    expect(decideFlowAiInput).not.toHaveBeenCalled();
  });

  it("saves an interpolated handoff summary as an internal conversation note", async () => {
    vi.mocked(classifyFlowSentiment).mockResolvedValue("negative");
    const { result, writes } = await dispatch("claimed", true, true, true, false, true, true, false, undefined, "necesito ayuda", true);
    expect(result.outcome).toBe("handed_off");
    expect(writes).toContainEqual(expect.objectContaining({
      account_id: "account",
      conversation_id: "conversation",
      author_user_id: "user",
      body: "Comentario: necesito ayuda",
      kind: "note",
    }));
  });

  it("hands uncertain comments or classifier errors to the team without advancing", async () => {
    vi.mocked(classifyFlowSentiment).mockResolvedValueOnce("handoff").mockRejectedValueOnce(new Error("unavailable"));
    for (let i = 0; i < 2; i++) {
      const { result, writes } = await dispatch("claimed", true, true, true, false, true);
      expect(result.outcome).toBe("handed_off");
      expect(writes.some((write) => "p_new_vars" in write)).toBe(false);
    }
  });

  it("queues transfer context without the normal message delay when enabled", async () => {
    analysisEnabled = true;
    vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "handoff" });
    const { result, calls } = await dispatch("claimed", true, true);
    expect(result.outcome).toBe("handed_off");
    expect(calls).toContain("queue_ai_analysis_job");
  });

  it("takes the non-negative branch only after saving the classification", async () => {
    vi.mocked(classifyFlowSentiment).mockResolvedValue("positive");
    const { result, writes } = await dispatch("claimed", true, true, true, false, true);
    expect(result.outcome).toBe("completed");
    expect(writes).toContainEqual(expect.objectContaining({
      node_key: "sentiment_check",
      payload: expect.objectContaining({ condition_result: "false", advancing_to: "end" }),
    }));
  });

  it("does not choose a branch if the captured state became stale", async () => {
    vi.mocked(classifyFlowSentiment).mockResolvedValue("negative");
    const { result, writes } = await dispatch("claimed", true, true, false, false, true, false);
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(writes.some((write) => write.node_key === "sentiment_check")).toBe(false);
  });

  it("captures an inbound photo only when the question accepts images", async () => {
    const { result, writes } = await dispatch("claimed", true, true, true, false, false, true, true);
    expect(result.outcome).toBe("completed");
    expect(writes).toContainEqual(expect.objectContaining({
      p_new_vars: expect.objectContaining({ ticket: "Foto adjunta en esta conversación" }),
    }));
  });

  it("applies deterministic formats to captured answers before advancing", async () => {
    vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "capture", value: "125,50" });
    const { result, writes } = await dispatch("claimed", true, true, true, false, false, true, false, "positive_amount", "125,50");
    expect(result.outcome).toBe("completed");
    expect(writes).toContainEqual(expect.objectContaining({
      p_new_vars: expect.objectContaining({ value: "125.50" }),
    }));
  });

  it("does not capture sentiment after the turn becomes stale", async () => {
    vi.mocked(classifyFlowSentiment).mockResolvedValue("positive");
    const { result, writes } = await dispatch("claimed", false, true, true, false, true);
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(writes.some((write) => "p_new_vars" in write)).toBe(false);
  });

  it("uses a date already given with the menu selection after validation", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-20T18:00:00Z"));
    try {
      vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "book", requested_date: "21/11/2026" });
      const { result, writes } = await dispatch("claimed", true, false, true, true);
      expect(result.outcome).toBe("completed");
      expect(writes).toContainEqual(expect.objectContaining({
        p_new_vars: expect.objectContaining({ fecha: "21/11/2026" }),
      }));
      expect(flowSendText).not.toHaveBeenCalledWith(expect.objectContaining({ text: "Fecha" }));
      expect(decideFlowAiTurn).toHaveBeenCalledWith(expect.objectContaining({
        dateOptions: [{ id: "book", today: "20/11/2026" }],
      }));
    } finally { vi.useRealTimers(); }
  });

  it("asks the date normally if the interpreted date is past", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-20T18:00:00Z"));
    try {
      vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "book", requested_date: "19/11/2026" });
      const { writes } = await dispatch("claimed", true, false, true, true);
      expect(writes.some((write) => "p_new_vars" in write)).toBe(false);
      expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Fecha" }));
    } finally { vi.useRealTimers(); }
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

  it("uses the interpreted date only after deterministic validation", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-20T18:00:00Z"));
    try {
      vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "capture", value: "19/11/2026" });
      const { result, writes } = await dispatch("claimed", true, true);
      expect(result.outcome).toBe("fallback_fired");
      expect(writes.some((write) => "vars" in write)).toBe(false);
      expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({
        text: "Elige una fecha válida de hoy en adelante.",
      }));
      expect(decideFlowAiInput).toHaveBeenCalledWith(expect.objectContaining({ dateToday: "20/11/2026" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not capture an ambiguous response as free text", async () => {
    vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "unknown" });
    const { result, writes } = await dispatch("claimed", true, true);
    expect(result.outcome).toBe("fallback_fired");
    expect(writes.some((write) => "vars" in write)).toBe(false);
  });

  it("captures a valid interpreted date and continues", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-20T18:00:00Z"));
    try {
      vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "capture", value: "21/11/2026" });
      const { result, writes } = await dispatch("claimed", true, true);
      expect(result.outcome).toBe("completed");
      expect(writes).toContainEqual(expect.objectContaining({
        vars: { __flow_ai_enabled: true, fecha: "21/11/2026" },
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reprompt after the run has been handed off", async () => {
    vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "unknown" });
    const { result } = await dispatch("claimed", true, true, false);
    expect(result.outcome).toBe("stale_inbound_ignored");
    expect(flowSendText).not.toHaveBeenCalled();
  });

  it("hands off when an AI-assisted reprompt cannot be sent", async () => {
    vi.mocked(decideFlowAiInput).mockResolvedValue({ action: "unknown" });
    vi.mocked(flowSendText).mockRejectedValueOnce(new Error("delivery failed"));
    const { result, calls } = await dispatch("claimed", true, true);
    expect(result.outcome).toBe("handed_off");
    expect(calls).toContain("handoff_flow_ai_turn");
  });
});

describe("natural protected appointment selection", () => {
  afterEach(() => vi.resetAllMocks());

  function fixture(options: { pendingOffer?: boolean; rejectSave?: boolean; shortConfirmation?: boolean } = {}) {
    const token = "abcdef12-3456-7890-abcd-ef1234567890";
    const run = {
      id: "run", flow_id: "flow", account_id: "account", user_id: "user",
      contact_id: "contact", conversation_id: "conversation", status: "active",
      current_node_key: "offer", reprompt_count: 0,
      vars: {
        __flow_ai_enabled: true, __guarded_appointments: true, __offer_token_offer: token,
        ...(options.pendingOffer ? { __offer_pending_offer: token } : {}),
        __slots_offer: [
          { id: "slot_1", title: "21 nov 19:30", start: "2035-11-22T01:30:00Z", end: "2035-11-22T03:00:00Z", localDate: "21/11/2035", localTime: "19:30" },
          { id: "slot_2", title: "21 nov 18:00", start: "2035-11-22T00:00:00Z", end: "2035-11-22T01:30:00Z", localDate: "21/11/2035", localTime: "18:00" },
        ],
      } as Record<string, unknown>,
    };
    const nodes = [
      { node_key: "offer", node_type: "offer_slots", config: {
        text: "Elige un horario", ai_assist: true, var_key: "slot", next_node_key: "book",
        ai_confirmation_text: "Confirma {{vars.offer_date}} {{vars.offer_time}}",
        ai_allow_short_confirmation: options.shortConfirmation,
      } },
      { node_key: "book", node_type: "book_appointment", config: { slot_var_key: "slot", idempotent_booking: true, next_node_key: "end" } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    const db = createClient("https://db.example.test", "key", { global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop();
        if (table === "flow_runs" && init?.method === "GET") return Response.json([{ ...run }]);
        if (table === "flow_nodes") return Response.json(nodes);
        if (table === "flows") return Response.json([{ fallback_policy: { on_unknown_reply: "reprompt", max_reprompts: 2 } }]);
        if (table === "flow_run_events" && init?.method === "HEAD") {
          return new Response(null, { headers: { "content-range": "*/0" } });
        }
        if (table === "claim_flow_ai_turn") return Response.json([{ outcome: "claimed", turn_id: "turn", turn_node_key: "offer" }]);
        if (table === "is_flow_ai_turn_active" || table === "finish_flow_ai_turn") return Response.json(true);
        if (table === "handoff_flow_ai_turn") return Response.json(true);
        if (table === "apply_guarded_offer_fallback") return Response.json(true);
        if (table === "update_flow_run_vars_if_current") {
          if (options.rejectSave) return Response.json(false);
          const args = JSON.parse(String(init?.body)) as { p_expected_vars: Record<string, unknown>; p_new_vars: Record<string, unknown> };
          if (JSON.stringify(run.vars) !== JSON.stringify(args.p_expected_vars)) return Response.json(false);
          run.vars = args.p_new_vars;
          return Response.json(true);
        }
        if (table === "flow_runs" && init?.method === "PATCH") {
          const update = JSON.parse(String(init.body)) as { status?: string };
          if (update.status) run.status = update.status;
        }
        if (init?.body) return new Response(null, { status: 204 });
        return new Response("Unexpected request", { status: 500 });
      },
    } });
    vi.mocked(supabaseAdmin).mockReturnValue(db);
    vi.mocked(flowSendText).mockResolvedValue({ message_id: "sent" });
    vi.mocked(bookFlowAppointment).mockResolvedValue({ ok: true, appointmentId: "id", startsAt: "2035-11-22T01:30:00Z" });
    let messageId = 0;
    const answer = (text: string) => dispatchInboundToFlows({
      accountId: "account", userId: "user", contactId: "contact", conversationId: "conversation",
      channelType: "zernio_whatsapp", isFirstInboundMessage: false,
      message: { kind: "text", text, meta_message_id: `message-${++messageId}` },
    });
    return { answer, run };
  }

  it("interprets an option, asks for the local date and time, and books only after confirmation", async () => {
    const { answer, run } = fixture();
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "slot_1" });
    expect((await answer("la primera opción por favor")).outcome).toBe("advanced");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
    expect(flowSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Confirma 21/11/2035 19:30" }));
    expect(run.vars.__offer_confirmation_offer).toMatchObject({ slotId: "slot_1", date: "21/11/2035", time: "19:30" });
    expect((await answer("confirmo 21/11/2035 19:30")).outcome).toBe("completed");
    expect(bookFlowAppointment).toHaveBeenCalledOnce();
    expect(bookFlowAppointment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      expectedOfferToken: "abcdef12-3456-7890-abcd-ef1234567890",
      vars: expect.objectContaining({ slot: "2035-11-22T01:30:00Z" }),
    }));
  });

  it("does not book a negative or wrong-date confirmation", async () => {
    const { answer } = fixture();
    vi.mocked(decideFlowAiTurn).mockResolvedValueOnce({ action: "route", reply_id: "slot_1" })
      .mockResolvedValue({ action: "unknown" });
    await answer("la primera");
    await answer("no confirmo 21/11/2035 19:30");
    await answer("confirmo 22/11/2035 19:30");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("accepts a short affirmative only when explicitly enabled and a selection is pending", async () => {
    const { answer } = fixture({ shortConfirmation: true });
    vi.mocked(decideFlowAiTurn).mockResolvedValueOnce({ action: "route", reply_id: "slot_1" })
      .mockResolvedValue({ action: "unknown" });
    await answer("la primera");
    await answer("confirmado gracias");
    expect(bookFlowAppointment).toHaveBeenCalledOnce();
  });

  it("clears the pending selection after a negative response before reoffering slots", async () => {
    const { answer } = fixture({ shortConfirmation: true });
    vi.mocked(decideFlowAiTurn).mockResolvedValueOnce({ action: "route", reply_id: "slot_1" })
      .mockResolvedValue({ action: "unknown" });
    await answer("la primera");
    await answer("no confirmado gracias");
    await answer("sí");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("keeps requiring date and time by default", async () => {
    const { answer } = fixture();
    vi.mocked(decideFlowAiTurn).mockResolvedValueOnce({ action: "route", reply_id: "slot_1" })
      .mockResolvedValue({ action: "unknown" });
    await answer("la primera");
    await answer("confirmado gracias");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("does not accept a short confirmation for a previous offer", async () => {
    const { answer, run } = fixture({ shortConfirmation: true });
    vi.mocked(decideFlowAiTurn).mockResolvedValueOnce({ action: "route", reply_id: "slot_1" })
      .mockResolvedValue({ action: "unknown" });
    await answer("la primera");
    run.vars.__offer_token_offer = "different-offer";
    await answer("confirmado gracias");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("does not bypass date and time confirmation using a code", async () => {
    const { answer } = fixture();
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "unknown" });
    await answer("1 ABCDEF123456");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("does not send a confirmation or book if state changes or the offer is still being delivered", async () => {
    for (const options of [{ rejectSave: true }, { pendingOffer: true }]) {
      vi.clearAllMocks();
      const { answer } = fixture(options);
      vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "slot_1" });
      expect((await answer("la primera")).outcome).toBe("handed_off");
      expect(flowSendText).not.toHaveBeenCalled();
      expect(bookFlowAppointment).not.toHaveBeenCalled();
    }
  });

  it("does not book a confirmation tied to a previous offer", async () => {
    const { answer, run } = fixture();
    vi.mocked(decideFlowAiTurn).mockResolvedValueOnce({ action: "route", reply_id: "slot_1" })
      .mockResolvedValue({ action: "unknown" });
    await answer("la primera");
    run.vars.__offer_token_offer = "different-offer";
    await answer("confirmo 21/11/2035 19:30");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });

  it("hands off if the confirmation message cannot be sent", async () => {
    const { answer } = fixture();
    vi.mocked(decideFlowAiTurn).mockResolvedValue({ action: "route", reply_id: "slot_1" });
    vi.mocked(flowSendText).mockRejectedValueOnce(new Error("delivery failed"));
    expect((await answer("la primera")).outcome).toBe("handed_off");
    expect(bookFlowAppointment).not.toHaveBeenCalled();
  });
});
