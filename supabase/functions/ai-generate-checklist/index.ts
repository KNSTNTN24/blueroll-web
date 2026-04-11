const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert food safety consultant generating HACCP checklists for UK restaurants under FSA Safer Food, Better Business (SFBB) regulations and EC Regulation 852/2004.

═══ OUTPUT FORMAT ═══
Return ONLY a valid JSON object (no markdown, no commentary):
{
  "name": "Checklist Name",
  "description": "One-sentence purpose",
  "frequency": "daily|weekly|monthly|four_weekly",
  "supervisor_role": "manager" or null,
  "assigned_roles": ["owner","manager","chef","kitchen_staff","front_of_house"],
  "items": [
    {
      "name": "Short action item (max 10 words)",
      "item_type": "tick|yes_no|temperature|text|photo",
      "required": true/false,
      "description": "Guidance note for staff" or null,
      "min_value": number or null,
      "max_value": number or null,
      "unit": "°C" or null
    }
  ]
}

═══ FSA CRITICAL TEMPERATURES (mandatory, never deviate) ═══
- Fridge: min 0°C, max 5°C (legal max 8°C but best practice is 5°C)
- Freezer: min -30°C, max -18°C
- Cooking core: 75°C minimum for 2 seconds
- Hot holding: 63°C minimum
- Reheating: 75°C minimum (82°C in Scotland)
- Cooling: must reach below 8°C within 90 minutes
- Danger zone: 8–63°C — food must not stay here over 2 hours

═══ STRICT RULES ═══
1. ONLY include items relevant to the checklist type. Do NOT mix concerns:
   - OPENING: temperature checks, food date checks, hygiene readiness, probe test. NO cleaning tasks.
   - CLOSING: equipment shutdown, leftover storage, final temp check, waste disposal, security. NO cleaning schedules.
   - TEMPERATURE LOG: ONLY temperature readings for each piece of equipment listed. Nothing else. One "temperature" item per unit. End with one "text" item for corrective actions.
   - CLEANING: ONLY cleaning/sanitising tasks. NO temperature checks. Use "tick" type for each task. Group by area (surfaces, floors, equipment).
   - HACCP REVIEW: 4-weekly management review. Checklist compliance, incident review, training needs, supplier checks, documentation. Use "yes_no" and "text" types. Frequency must be "four_weekly".
   - CUSTOM: follow user instructions precisely.

2. One temperature item PER piece of equipment — NOT one generic "check all fridges" item. If user lists "Fridge, Fridge 2, Freezer" → generate 3 separate temperature items.

3. Keep item count tight:
   - Temperature Log: exactly 1 item per equipment + 1 text item for issues = that's it
   - Opening/Closing: 8–14 items maximum
   - Cleaning: 8–15 items
   - HACCP Review: 10–15 items

4. Item names must be SHORT (max 10 words). Put detail in the "description" field.

5. "required" = true ONLY for items that are legally mandatory under FSA/SFBB. Optional nice-to-haves get required = false.

6. Do NOT include generic filler items like "Any other issues" or "General notes" unless the checklist has fewer than 6 items.

7. For temperature items: min_value and max_value are MANDATORY. Use FSA values above. Fridge = {min:0, max:5}. Freezer = {min:-30, max:-18}. Hot holding = {min:63, max:100}. Cooking = {min:75, max:100}.

8. Use the exact equipment names provided by the user. Do not rename "Fridge 2" to "Secondary refrigerator".

Return ONLY valid JSON, no other text.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { prompt, business_type, business_name } = body;

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Please provide a description of the checklist you need." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicKey) {
      console.log("ANTHROPIC_API_KEY not set — returning mock checklist");
      const mock = {
        name: "Daily Opening Checklist",
        description: "Morning checks before service begins",
        frequency: "daily",
        supervisor_role: null,
        assigned_roles: ["owner", "manager", "chef", "kitchen_staff"],
        items: [
          { name: "Fridge 1 temperature", item_type: "temperature", required: true, description: "Check and record fridge temperature. Must be 1–5°C.", min_value: 0, max_value: 5, unit: "°C" },
          { name: "Freezer temperature", item_type: "temperature", required: true, description: "Must be −18°C or below.", min_value: -30, max_value: -18, unit: "°C" },
          { name: "Probe thermometer working", item_type: "yes_no", required: true, description: "Test with boiling water (100°C) or ice water (0°C)", min_value: null, max_value: null, unit: null },
          { name: "Handwash basin stocked", item_type: "yes_no", required: true, description: "Hot water, liquid soap, and paper towels available", min_value: null, max_value: null, unit: null },
          { name: "Food in date and labelled", item_type: "yes_no", required: true, description: "All food has prep date + use-by. Discard out-of-date items.", min_value: null, max_value: null, unit: null },
          { name: "Raw and RTE food separated", item_type: "yes_no", required: true, description: "Raw stored below ready-to-eat in fridge", min_value: null, max_value: null, unit: null },
        ],
      };
      return new Response(JSON.stringify(mock), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMessage = [
      business_name ? `Business: ${business_name}` : null,
      business_type ? `Type: ${business_type}` : null,
      `Request: ${prompt}`,
    ].filter(Boolean).join("\n");

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error(`Claude API error: ${claudeResponse.status}`, errText);
      throw new Error(`AI service error: ${claudeResponse.status}`);
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text ?? "";

    let checklist;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        checklist = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in AI response");
      }
    } catch {
      console.error("Parse error. Raw response:", responseText.substring(0, 500));
      throw new Error("Failed to parse checklist from AI response");
    }

    return new Response(JSON.stringify(checklist), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-generate-checklist error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
