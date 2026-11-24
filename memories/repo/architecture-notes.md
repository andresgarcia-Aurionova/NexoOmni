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
