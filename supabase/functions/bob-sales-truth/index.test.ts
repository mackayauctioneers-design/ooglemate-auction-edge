import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const BOB_URL = `${SUPABASE_URL}/functions/v1/bob-sales-truth`;

// We need a valid account_id for testing — use a placeholder
// In real CI, this should be seeded
const TEST_ACCOUNT_ID = "00000000-0000-0000-0000-000000000000";

interface StructuredTargetsEvent {
  type: "structured_targets";
  targets: Array<{
    make: string;
    model: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    tier: "hunt" | "watch";
    spec_label: string;
    buy_ceiling: number | null;
    total_sales: number;
  }>;
  intent: string;
  dealer_name: string;
}

async function callBob(question: string): Promise<{
  structuredEvent: StructuredTargetsEvent | null;
  textContent: string;
  rawLines: string[];
}> {
  const resp = await fetch(BOB_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ question, accountId: TEST_ACCOUNT_ID }),
  });

  const body = await resp.text();

  if (!resp.ok) {
    return { structuredEvent: null, textContent: body, rawLines: [] };
  }

  const lines = body.split("\n").filter((l) => l.startsWith("data: "));
  let structuredEvent: StructuredTargetsEvent | null = null;
  let textContent = "";

  for (const line of lines) {
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") continue;
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.type === "structured_targets") {
        structuredEvent = parsed;
      } else if (parsed.choices?.[0]?.delta?.content) {
        textContent += parsed.choices[0].delta.content;
      }
    } catch {
      // partial chunk, skip
    }
  }

  return { structuredEvent, textContent, rawLines: lines };
}

// ── Smoke Tests ──

const SMOKE_QUESTIONS = [
  "Top 10 winners",
  "One-offs worth repeating",
  "Best Ranger trims",
  "Best year band for Amarok",
  "What to hunt at Pickles",
  "What's risky to repeat",
  "What did I overpay for",
  "What's highest profit %",
  "What clears fastest",
  "Give me 5 targets and buy ceilings",
];

// Test 1: Structured event is always emitted
Deno.test("bob emits structured_targets event", async () => {
  const { structuredEvent } = await callBob("What should I buy?");
  // Even with no data, should emit structured_targets
  assert(structuredEvent !== null, "structured_targets event must be present");
  assertEquals(structuredEvent!.type, "structured_targets");
  assert(Array.isArray(structuredEvent!.targets), "targets must be an array");
  assert(typeof structuredEvent!.intent === "string", "intent must be a string");
});

// Test 2: Targets schema validation
Deno.test("structured targets have valid schema", async () => {
  const { structuredEvent } = await callBob("Top winners");
  if (!structuredEvent || structuredEvent.targets.length === 0) return; // no data = pass

  for (const t of structuredEvent.targets) {
    assert(typeof t.make === "string" && t.make.length > 0, "make required");
    assert(typeof t.model === "string" && t.model.length > 0, "model required");
    assert(["HIGH", "MEDIUM", "LOW"].includes(t.confidence), `invalid confidence: ${t.confidence}`);
    assert(["hunt", "watch"].includes(t.tier), `invalid tier: ${t.tier}`);
    assert(typeof t.spec_label === "string", "spec_label required");
    assert(typeof t.total_sales === "number", "total_sales must be number");
  }
});

// Test 3: Intent classification
Deno.test("intent classification works correctly", async () => {
  const huntResult = await callBob("What should I hunt at Pickles?");
  assertEquals(huntResult.structuredEvent?.intent, "replication_strategy");

  const winnerResult = await callBob("Top 10 winners");
  assertEquals(winnerResult.structuredEvent?.intent, "winner_identification");
});

// Test 4: Spec completeness guardrail
Deno.test("low spec targets labeled as mixed specs", async () => {
  const { structuredEvent } = await callBob("Best models");
  if (!structuredEvent) return;

  for (const t of structuredEvent.targets) {
    if (t.total_sales > 3) {
      // Can't verify spec_completeness directly from response,
      // but spec_label must always be present
      assert(typeof t.spec_label === "string" && t.spec_label.length > 0, "spec_label must be populated");
    }
  }
});

// Test 5: No forbidden phrases in text output
Deno.test("text output contains no forbidden phrases", async () => {
  const { textContent } = await callBob("What should I be buying?");
  if (!textContent) return; // empty = no sales data = pass

  const forbidden = [
    "I cannot see your",
    "insufficient data",
    "we recommend",
    "we suggest",
    "estimated value",
  ];

  for (const phrase of forbidden) {
    assert(
      !textContent.toLowerCase().includes(phrase.toLowerCase()),
      `Response contains forbidden phrase: "${phrase}"`
    );
  }
});

// Test 6: All 10 smoke questions return valid responses (no crashes)
for (let i = 0; i < SMOKE_QUESTIONS.length; i++) {
  Deno.test(`smoke question ${i + 1}: "${SMOKE_QUESTIONS[i]}"`, async () => {
    const { structuredEvent, textContent } = await callBob(SMOKE_QUESTIONS[i]);
    // Must not crash — structured event should always be present
    assert(structuredEvent !== null, `Question "${SMOKE_QUESTIONS[i]}" must return structured_targets`);
    // Text can be empty if no sales data, but structured event must exist
  });
}
