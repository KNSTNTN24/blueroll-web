import { buildChecksPrompt } from "./prompt.ts";
import { buildContent } from "./_content.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_IMAGES = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { images, text } = body;

    if (!Array.isArray(images) || images.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Please attach at least one photo of your existing checklists.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (images.length > MAX_IMAGES) {
      return new Response(
        JSON.stringify({ error: `Please attach at most ${MAX_IMAGES} photos.` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const prompt = buildChecksPrompt();

    if (!anthropicKey) {
      console.log("ANTHROPIC_API_KEY not set — returning empty checklists");
      return new Response(JSON.stringify({ checklists: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const promptText = text
      ? `${prompt}\n\nAdditional context from the owner: ${text}`
      : prompt;

    const content = buildContent(images, promptText);

    console.log(`Extracting checklists from ${images.length} image(s)`);

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
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: content,
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
    console.error("onboard-extract-checks error:", err);
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
