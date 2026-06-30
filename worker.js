// =============================================================================
// ShareNet Worker — AI Assistant + Content Moderation
// Routes:
//   POST /          → AI chatbot (OpenAI gpt-4o-mini)
//   POST /moderate  → Content moderation (OpenAI /v1/moderations — free)
// =============================================================================

// ── Chatbot system prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a helpful assistant for ShareNet, a school community social platform. Here is everything about the site:

FEATURES:
- Groups: Browse public/private groups. Public allows any logged-in user to post. Private requires membership. 
- Post Feed: Posts can contain text, a headline, images (under 700KB), videos, file attachments, polls (simple/grid), and embedded HTML. 
- Comments: Click the comment count on any post to expand the comment section. 
- Members: Shows all registered users.
- Notifications: The bell icon in the nav shows unread count.
- Messenger: Direct messaging between users via the sidebar.
- Profile Settings: Click your avatar to open profile settings (display name/picture).
- Admin: Admins can approve groups, delete posts/comments, and manage users.

HOW TO:
- Post: Click "What's on your mind?" in a group feed.
- Create a group: Click "+ Request Group" in the sidebar.
- Change profile: Click your avatar icon.
- Find notifications: Click the bell icon.
- Message someone: Go to Messenger in the nav.

YOUR ROLE:
Help users navigate the site, but also act as a valuable community member. You can help users write announcements, summarize long posts, brainstorm club ideas, generate polls, or explain homework concepts (if appropriate). Keep responses concise, friendly, and formatted neatly.`;

// No moderation prompt needed — we use OpenAI's dedicated /v1/moderations API
// which is free, fast, and returns structured category flags.

// ── CORS headers ──────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    // ── Route: /moderate ─────────────────────────────────────────────────────
    if (url.pathname === "/moderate") {
      return handleModeration(request, env);
    }

    // ── Route: / (chatbot) ───────────────────────────────────────────────────
    return handleChatbot(request, env);
  },
};

// ── Chatbot handler (OpenAI) ──────────────────────────────────────────────────
async function handleChatbot(request, env) {
  try {
    const body = await request.json();
    const userMessages = body.messages || [];

    const openAiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...userMessages,
    ];

    const openAiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: openAiMessages,
          max_tokens: 1000,
          temperature: 0.7,
        }),
      }
    );

    if (!openAiResponse.ok) {
      const errorText = await openAiResponse.text();
      console.error("OpenAI API Error:", errorText);
      throw new Error("Failed to fetch from OpenAI");
    }

    const data = await openAiResponse.json();
    return jsonResponse(data);
  } catch (error) {
    console.error("Chatbot error:", error);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}

// ── Moderation handler (OpenAI /v1/moderations — free, no tokens used) ────────
async function handleModeration(request, env) {
  try {
    const body = await request.json();
    const text = (body.text || "").trim();

    if (!text) return jsonResponse({ allowed: true });

    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!response.ok) {
      // Fail open — don't block users if the API is down
      console.error("OpenAI moderation error:", await response.text());
      return jsonResponse({ allowed: true });
    }

    const data = await response.json();
    const result = data?.results?.[0];

    if (!result) return jsonResponse({ allowed: true });

    if (result.flagged) {
      // Find which categories were triggered to give a useful reason
      const categories = result.categories;
      const triggered = [];
      if (categories.hate || categories["hate/threatening"])
        triggered.push("hate speech");
      if (
        categories["self-harm"] ||
        categories["self-harm/intent"] ||
        categories["self-harm/instructions"]
      )
        triggered.push("self-harm content");
      if (categories.harassment || categories["harassment/threatening"])
        triggered.push("harassment or threats");
      if (categories.sexual || categories["sexual/minors"])
        triggered.push("sexual content");
      if (categories.violence || categories["violence/graphic"])
        triggered.push("violent content");

      const reason =
        triggered.length > 0
          ? `Your message was flagged for ${triggered.join(
              " and "
            )} and isn't allowed on ShareNet.`
          : "Your message was flagged as harmful content and isn't allowed on ShareNet.";

      return jsonResponse({ allowed: false, reason });
    }

    return jsonResponse({ allowed: true });
  } catch (error) {
    // Fail open on any error
    console.error("Moderation error:", error);
    return jsonResponse({ allowed: true });
  }
}
