import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@/lib/ai/types";
import { loadAiConfig } from "@/lib/ai/config";
import { generateText } from "@/lib/ai/generate";
import { retrieveKnowledge } from "@/lib/ai/knowledge";
import { logAiUsage } from "@/lib/ai/usage";
import { decideFlowAiInput, decideFlowAiTurn } from "./ai-assist";

vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: vi.fn() }));
vi.mock("@/lib/ai/generate", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/ai/knowledge", () => ({ retrieveKnowledge: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ logAiUsage: vi.fn() }));

const args = {
  accountId: "account", conversationId: "conversation", turnId: "turn",
  text: "¿Dónde están?", prompt: "¿Qué necesitas?",
  options: [{ id: "booking", title: "Reservar" }],
};

describe("flow AI decisions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadAiConfig).mockResolvedValue({} as AiConfig);
    vi.mocked(retrieveKnowledge).mockResolvedValue(["Dirección autorizada."]);
    vi.mocked(generateText).mockResolvedValue({
      text: '{"action":"answer","excerpt_index":0}',
      provider: "openai", model: "test", latencyMs: 1,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  });

  it("charges the turn and returns only the selected authorized excerpt", async () => {
    expect(await decideFlowAiTurn(args)).toEqual({ action: "answer", text: "Dirección autorizada." });
    expect(logAiUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ billingIdempotencyKey: "turn" }));
  });

  it("blocks unconfigured routes and nonexistent excerpts after recording usage", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"action":"route","reply_id":"invented"}', provider: "openai", model: "test", latencyMs: 1,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await expect(decideFlowAiTurn(args)).rejects.toThrow("unknown route");
    expect(logAiUsage).toHaveBeenCalledOnce();
    vi.mocked(retrieveKnowledge).mockResolvedValueOnce([]);
    await expect(decideFlowAiTurn(args)).rejects.toThrow("invalid authorized excerpt");
  });

  it("does not use a generated decision when the credit debit fails", async () => {
    vi.mocked(logAiUsage).mockRejectedValueOnce(new Error("debit failed"));
    await expect(decideFlowAiTurn(args)).rejects.toThrow("debit failed");
  });

  it("rejects a date attached to a route that does not support date capture", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"action":"route","reply_id":"booking","requested_date":"21/11/2026"}',
      provider: "openai", model: "test", latencyMs: 1,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await expect(decideFlowAiTurn(args)).rejects.toThrow("unsupported route");
  });

  it("does not invent free-text values not present in the message", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"action":"capture","value":"Inventado"}', provider: "openai", model: "test", latencyMs: 1,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await expect(decideFlowAiInput(args)).rejects.toThrow("unsupported captured value");
    expect(logAiUsage).toHaveBeenCalledOnce();
  });
});
