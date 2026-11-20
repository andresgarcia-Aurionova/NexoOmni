import { describe, it, expect } from "vitest";
import { validateFlowForActivation, reachableFromEntry } from "./validate";

const validFlow = {
  name: "Welcome",
  trigger_type: "keyword" as const,
  trigger_config: { keywords: ["support"] },
  entry_node_id: "start",
};

const validNodes = [
  { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "How can we help?",
      buttons: [
        { reply_id: "a", title: "A", next_node_key: "ho" },
        { reply_id: "b", title: "B", next_node_key: "ho" },
      ],
    },
  },
  { node_key: "ho", node_type: "handoff", config: {} },
];

describe("validateFlowForActivation — happy path", () => {
  it("produces no issues on a well-formed flow", () => {
    expect(validateFlowForActivation(validFlow, validNodes)).toEqual([]);
  });
});

describe("connected line validation", () => {
  it("rejects malformed connector identifiers while preserving unscoped flows", () => {
    expect(validateFlowForActivation({
      ...validFlow, trigger_config: { keywords: ["support"], connector_id: "bad" },
    }, validNodes)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "trigger_config.connector_id" }),
    ]));
    expect(validateFlowForActivation({
      ...validFlow, trigger_config: { keywords: ["support"], connector_id: "12345678-1234-1234-1234-123456789012" },
    }, validNodes)).toEqual([]);
  });
});

describe("accepted input values", () => {
  it("rejects empty or ambiguous lists before activation", () => {
    const nodes = (allowed_values: unknown) => [
      { node_key: "start", node_type: "start", config: { next_node_key: "sede" } },
      { node_key: "sede", node_type: "collect_input", config: {
        prompt_text: "Sede", var_key: "sede", next_node_key: "end", allowed_values,
      } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    for (const invalid of [[], [""], ["Tabgha", "tabgha"], ["Metz", "Métz"]]) {
      expect(validateFlowForActivation(validFlow, nodes(invalid))).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "allowed_values" })]),
      );
    }
    expect(validateFlowForActivation(validFlow, nodes(["Tabgha", "Metz"]))).toEqual([]);
  });

  describe("sentiment input validation", () => {
    const nodes = (extra: Record<string, unknown>) => [
      { node_key: "start", node_type: "start", config: { next_node_key: "comment" } },
      { node_key: "comment", node_type: "collect_input", config: {
        prompt_text: "Comentario", var_key: "comment", next_node_key: "end",
        ai_assist: true, ai_sentiment_var_key: "sentiment", ...extra,
      } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    it("requires a separate key and compatible AI-only input", () => {
      expect(validateFlowForActivation(validFlow, nodes({}))).toEqual([]);
      for (const extra of [
        { ai_sentiment_var_key: "comment" }, { ai_sentiment_var_key: "__internal" },
        { var_key: "__internal" },
        { ai_assist: false }, { save_contact_note: true }, { allowed_values: ["x"] },
        { date_not_past: true }, { time_24h: true },
      ]) {
        expect(validateFlowForActivation(validFlow, nodes(extra))).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: "ai_sentiment_var_key" })]),
        );
      }
    });
  });
});

describe("preferred appointment time validation", () => {
  it("requires a valid time variable and a date variable", () => {
    const nodes = (time_var_key: string, date_var_key?: string) => [
      { node_key: "start", node_type: "start", config: { next_node_key: "slots" } },
      { node_key: "slots", node_type: "offer_slots", config: {
        text: "Horarios", var_key: "slot", time_var_key, date_var_key,
        next_node_key: "end", no_availability_next: "end",
      } },
      { node_key: "end", node_type: "end", config: {} },
    ];
    expect(validateFlowForActivation(validFlow, nodes("hora"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "date_var_key" })]),
    );
    expect(validateFlowForActivation(validFlow, nodes("1hora", "fecha"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "time_var_key" })]),
    );
    expect(validateFlowForActivation(validFlow, nodes("hora", "fecha"))).toEqual([]);
  });
});

describe("contact note capture validation", () => {
  const nodes = (label: string) => [
    { node_key: "start", node_type: "start", config: { next_node_key: "reason" } },
    { node_key: "reason", node_type: "collect_input", config: {
      prompt_text: "Reason?", var_key: "motivo", next_node_key: "end",
      save_contact_note: true, contact_note_label: label,
    } },
    { node_key: "end", node_type: "end", config: {} },
  ]
  it("requires a descriptive label for automatic notes", () => {
    expect(validateFlowForActivation(validFlow, nodes(" "))).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "contact_note_label" })]),
    )
    expect(validateFlowForActivation(validFlow, nodes("Motivo (flujo automático)"))).toEqual([])
  })

  describe("date input validation", () => {
    it("requires a valid time zone only when date validation is enabled", () => {
      const nodes = (date_not_past: boolean, date_timezone: string) => [
        { node_key: "start", node_type: "start", config: { next_node_key: "date" } },
        { node_key: "date", node_type: "collect_input", config: {
          prompt_text: "Fecha DD/MM/AAAA", var_key: "fecha", next_node_key: "end",
          date_not_past, date_timezone,
        } },
        { node_key: "end", node_type: "end", config: {} },
      ];
      expect(validateFlowForActivation(validFlow, nodes(true, "bad-zone"))).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "date_timezone" })]),
      );
      expect(validateFlowForActivation(validFlow, nodes(true, "America/Mexico_City"))).toEqual([]);
      expect(validateFlowForActivation(validFlow, nodes(false, ""))).toEqual([]);
    });
  });

  describe("appointment reference validation", () => {
    it("rejects a malformed optional reference variable", () => {
      const nodes = [
        { node_key: "start", node_type: "start", config: { next_node_key: "book" } },
        { node_key: "book", node_type: "book_appointment", config: {
          slot_var_key: "slot", title: "Reserva", reference_var_key: "1invalida", next_node_key: "end",
        } },
        { node_key: "end", node_type: "end", config: {} },
      ];
      expect(validateFlowForActivation(validFlow, nodes)).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "reference_var_key" })]),
      );
    });
  });
})

describe("validateFlowForActivation — flow-level", () => {
  it("flags empty name", () => {
    expect(
      validateFlowForActivation({ ...validFlow, name: "" }, validNodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "flow", field: "name" }),
      ]),
    );
  });

  it("flags whitespace-only name", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, name: "   " },
      validNodes,
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing entry_node_id", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      validNodes,
    );
    expect(issues.some((i) => i.field === "entry_node_id")).toBe(true);
  });

  it("flags entry_node_id that doesn't exist in nodes", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "ghost" },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "entry_node_id" &&
          i.message.includes('"ghost"'),
      ),
    ).toBe(true);
  });

  it("flags empty node list", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      [],
    );
    expect(
      issues.some((i) => i.scope === "flow" && !i.field),
    ).toBe(true);
  });

  it("flags duplicate node_key", () => {
    const dupes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      dupes,
    );
    expect(
      issues.some(
        (i) =>
          i.message.includes("está duplicada") &&
          i.node_key === "a",
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — trigger", () => {
  it("flags keyword trigger with no keywords", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: [] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.field === "trigger_config.keywords",
      ),
    ).toBe(true);
  });

  it("flags keyword trigger missing keywords field entirely", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, trigger_config: {} },
      validNodes,
    );
    expect(issues.some((i) => i.scope === "trigger")).toBe(true);
  });

  it("warns when keywords contain blanks", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: ["support", "", " "] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.severity === "warning" &&
          i.message.includes("vacías"),
      ),
    ).toBe(true);
  });

  it("first_inbound_message trigger needs no config", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_type: "first_inbound_message",
        trigger_config: {},
      },
      validNodes,
    );
    expect(issues.filter((i) => i.scope === "trigger")).toEqual([]);
  });
});

describe("validateFlowForActivation — nodes", () => {
  it("validates required appointment node configuration and branches", () => {
    const nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "slots" } },
      {
        node_key: "slots",
        node_type: "offer_slots",
        config: { text: "", var_key: "", next_node_key: "missing", no_availability_next: "also_missing" },
      },
      {
        node_key: "book",
        node_type: "book_appointment",
        config: { slot_var_key: "", title: "", next_node_key: "missing", conflict_next: "also_missing" },
      },
    ];
    const issues = validateFlowForActivation(validFlow, nodes);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node_key: "slots", field: "text" }),
        expect.objectContaining({ node_key: "slots", field: "var_key" }),
        expect.objectContaining({ node_key: "slots", field: "next_node_key" }),
        expect.objectContaining({ node_key: "slots", field: "no_availability_next" }),
        expect.objectContaining({ node_key: "book", field: "slot_var_key" }),
        expect.objectContaining({ node_key: "book", field: "title" }),
        expect.objectContaining({ node_key: "book", field: "next_node_key" }),
        expect.objectContaining({ node_key: "book", field: "conflict_next" }),
      ]),
    );
  });

  it("flags send_buttons without text", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          buttons: [{ reply_id: "x", title: "X", next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.node_key === "b" && i.field === "text"),
    ).toBe(true);
  });

  it("flags send_buttons with zero buttons", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: { text: "Hi", buttons: [] },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("al menos un botón"),
      ),
    ).toBe(true);
  });

  it("flags send_buttons with more than 3 buttons (Meta limit)", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "1", next_node_key: "h" },
            { reply_id: "2", title: "2", next_node_key: "h" },
            { reply_id: "3", title: "3", next_node_key: "h" },
            { reply_id: "4", title: "4", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("máximo 3"),
      ),
    ).toBe(true);
  });

  it("flags button title over 20 chars", () => {
    const longTitle = "x".repeat(21);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: longTitle, next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons.0.title" &&
          i.message.includes("supera 20"),
      ),
    ).toBe(true);
  });

  it("flags button pointing at non-existent next node", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "Go", next_node_key: "ghost" },
          ],
        },
      },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "buttons.0.next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags duplicate button reply_ids", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "x", title: "X1", next_node_key: "h" },
            { reply_id: "x", title: "X2", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("está duplicado")),
    ).toBe(true);
  });

  it("flags send_list with more than 10 rows total", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      reply_id: `r${i}`,
      title: `Row ${i}`,
      next_node_key: "h",
    }));
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [{ rows: eleven }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "l" &&
          i.field === "sections" &&
          i.message.includes("máximo 10"),
      ),
    ).toBe(true);
  });

  it("flags list row title over 24 chars", () => {
    const longTitle = "x".repeat(25);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [
            {
              rows: [
                {
                  reply_id: "x",
                  title: longTitle,
                  next_node_key: "h",
                },
              ],
            },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("supera 24")),
    ).toBe(true);
  });

  it("warns about unreachable nodes", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "handoff", config: {} },
      // Orphaned — nothing points at it.
      { node_key: "orphan", node_type: "end", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "orphan" &&
          i.severity === "warning" &&
          i.message.includes("no es alcanzable"),
      ),
    ).toBe(true);
  });

  it("doesn't crash on unknown node_type — flags it", () => {
    const nodes = [
      { node_key: "s", node_type: "wibble", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("no es reconocido")),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — send_media", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (mediaConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
    { node_key: "m", node_type: "send_media", config: mediaConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated send_media node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "document",
        media_url: "https://cdn.example/invoice.pdf",
        caption: "Your invoice",
        filename: "invoice.pdf",
        next_node_key: "h",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing media_url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_url"),
    ).toBe(true);
  });

  it("flags missing media_type", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_type"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "ghost",
      }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "m" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags caption exceeding 1024 chars", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        caption: "x".repeat(1025),
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "caption"),
    ).toBe(true);
  });

  it("contributes its next_node_key to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(set).toEqual(new Set(["s", "m", "h"]));
  });
});

describe("reachableFromEntry", () => {
  it("walks the graph from the entry", () => {
    const set = reachableFromEntry("start", validNodes);
    expect(set.has("start")).toBe(true);
    expect(set.has("menu")).toBe(true);
    expect(set.has("ho")).toBe(true);
  });

  it("returns the entry alone when no edges lead out", () => {
    const set = reachableFromEntry("only", [
      { node_key: "only", node_type: "handoff", config: {} },
    ]);
    expect(set).toEqual(new Set(["only"]));
  });

  it("survives a cycle (visited guard)", () => {
    const nodes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Loop",
          buttons: [{ reply_id: "x", title: "Back", next_node_key: "a" }],
        },
      },
    ];
    const set = reachableFromEntry("a", nodes);
    expect(set).toEqual(new Set(["a", "b"]));
  });
});
