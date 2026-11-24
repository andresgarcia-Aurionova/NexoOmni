# Omnichannel integrations

## 2026-11-24: connection transport and commercial channel identity

Zernio is an internal connection transport. New supported platforms are
stored as `zernio_<platform>` in conversation and connector rows, while
the UI, reports and deal attribution show the base commercial channel
(`Gmail`, `X`, `Threads`, etc.).

CRM-only integrations (`hubspot`, `salesforce`) are connectors, never
`ChannelType` values. Conversation providers and CRM providers must stay
separate: inventing a HubSpot or Salesforce conversation would bypass the
normal inbox model and duplicate memory.

Google Business uses `review.new` as an inbox event. Its `social_comment_id`
is the Google review id and outbound replies call
`/inbox/reviews/{reviewId}/reply`, not the generic conversation endpoint.
Threads comments, X replies and TikTok comments use the generic
`/inbox/comments` endpoint. The common outbound send helper must preserve
that distinction.

Telegram connection is code-based, not OAuth: the short-lived code is
stored only in the connection attempt metadata, polled after the user
adds the bot to a group/channel, and the connector is created only after
Zernio confirms completion.

## 2026-11-24: channel add-ons and after-hours AI

Channel availability is not a plan default. The platform operator enables
each `channel_*` override per account; migration 209 only backfills existing
WhatsApp/native Meta/Zernio connections so current tenants are not interrupted.
Client UI keeps the whole catalog visible, while connection, send, inbound
webhook and background-send paths must all enforce the matching entitlement.

Business hours block new flows and deterministic automations, but an enabled
AI auto-reply may still answer outside hours, including after image/PDF
analysis completes in the background. The closure notice is sent only when
neither an active flow nor the AI handled the inbound message.

Image/PDF validation uses OpenAI first for task pricing and reroutes provider
failures to Anthropic's vision/document blocks when the account has both chat
credentials. The retry preserves billable usage under the provider that
actually completed the request.

PostgreSQL checks for template names must separate `char_length(... ) <= 512`
from the character-class regex. A bound like `{1,512}` in the regex raises
`2201B invalid repetition count` and makes every settings insert fail.
