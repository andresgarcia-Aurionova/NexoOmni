import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyFlowSentiment } from "./ai-assist";
import { loadAiConfig } from "@/lib/ai/config";
import { generateText } from "@/lib/ai/generate";
import { logAiUsage } from "@/lib/ai/usage";

vi.mock("@/lib/ai/config", () => ({ loadAiConfig: vi.fn() }));
vi.mock("@/lib/ai/generate", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ logAiUsage: vi.fn() }));
vi.mock("./admin-client", () => ({ supabaseAdmin: vi.fn() }));

describe("flow comment sentiment", () => {
  const args = { accountId: "account", conversationId: "conversation", turnId: "turn", text: "No me gustó" };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadAiConfig).mockResolvedValue({} as Awaited<ReturnType<typeof loadAiConfig>>);
    vi.mocked(generateText).mockResolvedValue({
      text: '{"sentiment":"negative"}', provider: "openai", model: "test", latencyMs: 1,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it("charges the turn and accepts only a supported sentiment", async () => {
    await expect(classifyFlowSentiment(args)).resolves.toBe("negative");
    expect(logAiUsage).toHaveBeenCalledWith(undefined, expect.objectContaining({ billingIdempotencyKey: "turn" }));
  });

  it("rejects malformed or unsupported output", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"sentiment":"other"}', provider: "openai", model: "test", latencyMs: 1,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    await expect(classifyFlowSentiment(args)).rejects.toThrow();
  });

  it("blocks classification when billing fails", async () => {
    vi.mocked(logAiUsage).mockRejectedValue(new Error("billing failed"));
    await expect(classifyFlowSentiment(args)).rejects.toThrow("billing failed");
  });
});
