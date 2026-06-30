// =============================================================================
//  contentFilter.js — ShareNet Content Moderation Module
//
//  Two-layer approach:
//    1. Instant local word-list check (no API cost, fires every time)
//    2. AI check via Claude API for content that passes the word list but
//       may still be harmful (threats, harassment, hate speech, etc.)
//       — only called when text is ≥ 6 words so short messages aren't
//       penalised with false positives.
//
//  Usage:
//    import { checkContent } from "./contentFilter.js";
//    const result = await checkContent(text);
//    if (!result.allowed) { show result.reason; return; }
// =============================================================================

// ── 1. Local word list ────────────────────────────────────────────────────────
const BLOCKED_PATTERNS = [
    // Racial / ethnic slurs
    /\bn[i1!|]+g+[e3]r/i,
    /\bn[i1!|]+gg[a@]/i,
    /\bk[i1]+k[e3]/i,
    /\bsp[i1]+c/i,
    /\bch[i1]+nk/i,
    /\bgook/i,
    /\bwetback/i,
    /\bcr[a@]cker/i,
    /\btr[a@]nny/i,
    /\bf[a@4]gg[o0]t/i,
    /\bd[y1]k[e3]/i,
    /\bretard/i,
    /\bcr[i1]pple/i,
    /\bsp[a@]z/i,
  
    // Severe profanity
    /\bf+[u\*]+c+k/i,
    /\bsh[i1!]+t/i,
    /\ba+[s\$]+h[o0]l[e3]/i,
    /\bb[i1!]+tch/i,
    /\bc[u\*]nt/i,
    /\bd[i1!]+ck/i,
    /\bc[o0]ck/i,
    /\bp[u\*]+ss[y1]/i,
    /\bwh[o0]r[e3]/i,
    /\bsl[u\*]t/i,
    /\bb[a@]st[a@]rd/i,
    /\bd[a@]mn/i,
    /\bh[e3]ll/i,
    /\bcr[a@]p/i,
  
    // Threats / violence keywords (broad)
    /\bkill\s+(your?self|him|her|them|you|me)\b/i,
    /\bi('ll|will)\s+(kill|murder|stab|shoot|hurt)\b/i,
    /\bkys\b/i,
    /\bgys\b/i,
  ];
  
  /**
   * Fast synchronous check against the local word list.
   * @param {string} text
   * @returns {{ blocked: boolean, reason?: string }}
   */
  function localCheck(text) {
    const normalised = text
      .replace(/[@]/g, "a")
      .replace(/[3]/g, "e")
      .replace(/[1!|]/g, "i")
      .replace(/[0]/g, "o")
      .replace(/[\$]/g, "s")
      .replace(/[+]/g, "t");
  
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(normalised) || pattern.test(text)) {
        return {
          blocked: true,
          reason:
            "Your message contains language that isn't allowed on ShareNet. Please keep it respectful.",
        };
      }
    }
    return { blocked: false };
  }
  
  // ── 2. AI content check ───────────────────────────────────────────────────────
  
  const AI_FILTER_SYSTEM_PROMPT = `You are a strict content moderation assistant for a school community platform called ShareNet.
      Analyse the user message and decide whether it violates any of these rules:
      - Hate speech or slurs targeting any group
      - Threats of violence or self-harm
      - Severe harassment or bullying directed at an individual
      - Explicit sexual content
      - Encouragement of illegal activity
      
      Reply with EXACTLY ONE of:
        ALLOWED
        BLOCKED: <one-sentence plain-English reason>
      
      Do not add any other text. If in doubt, lean toward ALLOWED for normal teenage conversation.`;
  
  /**
   * Call the Claude API to check if content is harmful.
   * Returns { blocked: boolean, reason?: string }
   * Always fails open (returns allowed) on any network or API error.
   */
  async function aiCheck(text) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 60,
          system: AI_FILTER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
      });
  
      if (!response.ok) return { blocked: false };
  
      const data = await response.json();
      const reply = (data?.content?.[0]?.text || "").trim();
  
      if (reply.startsWith("BLOCKED:")) {
        const reason = reply.replace(/^BLOCKED:\s*/i, "").trim();
        return {
          blocked: true,
          reason: reason || "This message was flagged as harmful content.",
        };
      }
      return { blocked: false };
    } catch {
      // Network error, CORS block, or unexpected shape — always fail open
      return { blocked: false };
    }
  }
  
  // ── Public API ────────────────────────────────────────────────────────────────
  
  /**
   * Check a piece of user-generated text against both layers.
   *
   * @param {string} text  - The raw text to check
   * @param {object} [opts]
   * @param {boolean} [opts.aiEnabled=true]  - Set false to skip the AI layer
   * @returns {Promise<{ allowed: boolean, reason?: string }>}
   */
  export async function checkContent(text, { aiEnabled = true } = {}) {
    if (!text || !text.trim()) return { allowed: true };
  
    // Layer 1 — instant local check
    const local = localCheck(text);
    if (local.blocked) return { allowed: false, reason: local.reason };
  
    // Layer 2 — AI check (only for longer text to control cost + avoid false positives)
    const wordCount = text.trim().split(/\s+/).length;
    if (aiEnabled && wordCount >= 6) {
      const ai = await aiCheck(text);
      if (ai.blocked) return { allowed: false, reason: ai.reason };
    }
  
    return { allowed: true };
  }
  