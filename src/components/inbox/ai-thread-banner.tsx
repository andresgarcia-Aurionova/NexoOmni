"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Hand, Undo2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";

// ------------------------------------------------------------
// Refresh settings when opening a conversation so a changed line scope is
// not hidden behind an account-wide cached status.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
  maxReplies: number;
  connectorId: string | null;
}
async function fetchAiAccountStatus(): Promise<AiAccountStatus> {
  try {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    if (!res.ok) throw new Error(`AI configuration request failed (${res.status})`);
    const j = await res.json();
    if (j?.configured && j.auto_reply_connector_id !== null && typeof j.auto_reply_connector_id !== "string") {
      throw new Error("Invalid AI connector scope");
    }
    const status = {
      // AI auto-reply is "live" only when configured, the master switch
      // is on, and the inbound bot is enabled.
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
      connectorId: typeof j?.auto_reply_connector_id === "string" ? j.auto_reply_connector_id : null,
      maxReplies: Number.isFinite(Number(j?.auto_reply_max_per_conversation))
        ? Number(j.auto_reply_max_per_conversation)
        : 0,
    };
    return status;
  } catch (error) {
    console.error("[ai thread banner] could not load AI status:", error);
    return { autoReplyOn: false, maxReplies: 0, connectorId: null };
  }
}

interface AiThreadBannerProps {
  conversationId: string;
  connectorId?: string | null;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
  /** `conversations.ai_reply_count` — number of automatic replies used. */
  replyCount?: number;
  /** Current assignee; when a human owns the thread the bot won't run,
   *  so the "AI active" banner is suppressed. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" assigns the thread to them. */
  currentUserId?: string | null;
  /** Called after a successful toggle so the parent can patch its local
   *  conversation state (the realtime UPDATE also arrives, but this keeps
   *  the banner instant). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Inbox banner that surfaces + controls the AI auto-reply bot per
 * conversation:
 *   - bot active here → "AI is replying automatically" + [Take over]
 *   - bot paused here → the handoff note (if any) + [Resume AI]
 * Renders nothing when the account has no auto-reply configured, or when
 * the bot is active but a human already owns the thread (nothing to do).
 */
export function AiThreadBanner({
  conversationId,
  connectorId,
  disabled,
  handoffSummary,
  replyCount = 0,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  const { accountId } = useAuth();
  const [aiStatus, setAiStatus] = useState<{
    accountId: string;
    conversationId: string;
    status: AiAccountStatus;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyCountOverride, setReplyCountOverride] = useState<number | null>(null);
  // Optimistic local mirror of the pause flag so the banner flips
  // instantly on click; re-seeds whenever the thread (or its server
  // state via realtime) changes.
  const [paused, setPaused] = useState(disabled);
  useEffect(() => setPaused(disabled), [conversationId, disabled]);
  useEffect(() => setReplyCountOverride(null), [conversationId, replyCount]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus().then((status) => alive && setAiStatus({ accountId, conversationId, status }));
    return () => {
      alive = false;
    };
  }, [accountId, conversationId]);

  const toggle = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // "Take over" also assigns the thread to the acting agent.
          body: JSON.stringify({ paused, assign_to_me: paused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t("updateError"));
          return;
        }
        setPaused(paused);
        if (!paused) setReplyCountOverride(0);
        onChange?.({
          ai_autoreply_disabled: paused,
          // Take over assigns to the acting agent; resume releases only
          // the caller's own assignment. The realtime UPDATE reconciles
          // the exact value either way.
          ...(paused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(paused ? t("tookOver") : t("resumed"));
      } catch {
        toast.error(t("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t],
  );

  // Account has no auto-reply → nothing to show. (Still loading → nothing.)
  if (!aiStatus || aiStatus.accountId !== accountId || aiStatus.conversationId !== conversationId) return null;
  const status = aiStatus.status;
  if (!status.autoReplyOn) return null;
  if (status.connectorId && status.connectorId !== connectorId) return null;

  // Paused here (a human took over, or the model handed off).
  if (paused) {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t("pausedTitle")}</p>
          {handoffSummary && (
            <p className="truncate text-muted-foreground" title={handoffSummary}>
              {handoffSummary}
            </p>
          )}
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
          {t("resume")}
        </BannerButton>
      </Banner>
    );
  }

  // Active, but a human already owns it → the bot won't fire; no banner.
  if (assignedAgentId) return null;

  // This is account/thread status, not an in-progress typing signal.
  // Make the configured safety cap explicit so an agent understands why a
  // later inbound message did not receive another automatic reply.
  const visibleReplyCount = replyCountOverride ?? replyCount;
  if (status.maxReplies > 0 && visibleReplyCount >= status.maxReplies) {
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {t("limitReached", { count: visibleReplyCount, max: status.maxReplies })}
          </p>
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
          {t("reset")}
        </BannerButton>
      </Banner>
    );
  }

  // Active on this thread.
  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">
          {t("activeText")}
        </span>
      </div>
      <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
        {t("takeOver")}
      </BannerButton>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
