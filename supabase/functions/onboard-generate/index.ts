import { buildGeneratePrompt } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EngineBrief {
  key: string;
  title: string;
  frequency: string;
  prompt: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { briefs } = body as { briefs?: EngineBrief[] };

    if (!Array.isArray(briefs) || briefs.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Please provide at least one checklist brief.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicKey) {
      console.log("ANTHROPIC_API_KEY not set — returning empty checklists");
      return new Response(JSON.stringify({ checklists: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMessage = briefs
      .map((b, i) => `Brief ${i + 1}: title="${b.title}", frequency=${b.frequency}. ${b.prompt}`)
      .join("\n\n");

    console.log(`Generating checklists from ${briefs.length} brief(s)`);

    const claudeResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: buildGeneratePrompt(),
          messages: [
            {
              role: "user",
              content: userMessage,
            },
          ],
        }),
      },
    );

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error(`Claude API error: ${claudeResponse.status}`, errText);
      throw new Error(
        `Claude API error: ${claudeResponse.status} — ${errText.substring(0, 300)}`,
      );
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text ?? "";

    let result;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in Claude response");
      }
    } catch (parseErr) {
      console.error("Parse error. Raw response:", responseText.substring(0, 500));
      throw new Error(`Failed to parse checklists from AI response`);
    }

    const checklists = Array.isArray(result?.checklists) ? result.checklists : [];

    return new Response(JSON.stringify({ checklists }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("onboard-generate error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
