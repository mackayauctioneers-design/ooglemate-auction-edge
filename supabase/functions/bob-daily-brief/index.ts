import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate a daily brief context for Bob based on dealer data
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { dealerName = 'mate', dealership = '' } = body;

    // In production, these would come from actual database queries
    // For now, generate realistic mock data
    const mockBriefData = generateMockBriefData();

    // Build the brief context that will be injected into Bob's conversation
    const briefContext = buildBriefContext({
      dealerName,
      dealership,
      ...mockBriefData
    });

    console.log("Generated daily brief context for:", dealerName);

    return new Response(
      JSON.stringify({ 
        briefContext,
        hasOpportunities: mockBriefData.opportunities.length > 0,
        opportunityCount: mockBriefData.opportunities.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Brief generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

interface BriefData {
  dealerName: string;
  dealership: string;
  recentSalesReceived: boolean;
  salesCount: number;
  performanceNote: string;
  opportunities: Array<{
    type: 'match' | 'price_drop' | 'passed_in' | 'local_stock';
    description: string;
  }>;
  activeWork: string[];
}

function generateMockBriefData() {
  // Simulate different scenarios
  const scenarios = [
    // Good day with opportunities
    {
      recentSalesReceived: true,
      salesCount: 3,
      performanceNote: "Good quids on that Ranger last week. You're on a run.",
      opportunities: [
        { type: 'match' as const, description: "2021 HiLux SR5, 45k on it, coming up at Pickles Wednesday" },
        { type: 'price_drop' as const, description: "That Prado you were watching, guide dropped five grand" },
        { type: 'passed_in' as const, description: "RAV4 passed in yesterday at Manheim, thirty-two reserve" },
      ],
      activeWork: ["Checking network for late-model Colorados", "Got your saved search running twice daily"]
    },
    // Quiet day
    {
      recentSalesReceived: false,
      salesCount: 0,
      performanceNote: "",
      opportunities: [],
      activeWork: ["Watching the Pickles catalogue for you", "No saved search hits yet this week"]
    },
    // Medium activity
    {
      recentSalesReceived: true,
      salesCount: 1,
      performanceNote: "That Camry moved quick. Nice work.",
      opportunities: [
        { type: 'local_stock' as const, description: "Three Koronas hit Brisbane lane, your patch" },
        { type: 'match' as const, description: "Outlander PHEV, 2022, matches your spec" },
      ],
      activeWork: ["Got Macca looking at a Triton for you"]
    }
  ];

  // Pick a random scenario
  return scenarios[Math.floor(Math.random() * scenarios.length)];
}

function buildBriefContext(data: BriefData): string {
  const parts: string[] = [];

  // Greeting
  const greeting = data.dealership 
    ? `Hey ${data.dealerName}, it's Bob. Quick catch-up for ${data.dealership}.`
    : `G'day ${data.dealerName}, Bob here. Quick run-through for you.`;
  parts.push(greeting);

  // Sales acknowledgment
  if (data.recentSalesReceived && data.salesCount > 0) {
    parts.push(`Got your last ${data.salesCount} sale${data.salesCount > 1 ? 's' : ''} logged in.`);
    if (data.performanceNote) {
      parts.push(data.performanceNote);
    }
  }

  // Opportunities
  if (data.opportunities.length > 0) {
    parts.push(`Right, what's on today.`);
    data.opportunities.forEach((opp, i) => {
      if (i < 3) { // Max 3 opportunities
        parts.push(opp.description + ".");
      }
    });
    if (data.opportunities.length > 3) {
      parts.push(`Plus ${data.opportunities.length - 3} more in your queue.`);
    }
  } else {
    parts.push(`Nothing screaming at me today. Quiet lanes.`);
  }

  // Active work
  if (data.activeWork.length > 0) {
    parts.push(data.activeWork[0] + ".");
  }

  // Handoff
  parts.push(`If any of these look right, I'll talk to Macca and we'll get you sorted.`);
  
  // Clean close
  parts.push(`That's me. Over to you.`);

  return parts.join(' ');
}
