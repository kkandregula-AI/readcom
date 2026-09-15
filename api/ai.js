// ============================================================================
// Claude proxy for Local Reading Companion
// Designed & Architected by Krishnamurthy Kandregula · Made by Claude
// ============================================================================
// Deploy on Vercel. It keeps your API key server-side and streams plain text
// back to the app, so the browser never sees the key.
//
// SETUP
//   1. Put this file at:  api/ai.js  (alongside index.html + sw.js)
//   2. In Vercel -> Project -> Settings -> Environment Variables, add:
//         ANTHROPIC_API_KEY = sk-ant-...
//   3. Deploy. The app's HOSTED_ENDPOINT "/api/ai" now resolves to this.
//
// The app extracts Word/PDF text on-device and posts { task, system, text }.
// This function forwards it to Claude and relays the streamed text.
// ============================================================================

export const config = { runtime: "edge" };

const MODEL = "claude-sonnet-5";          // swap to "claude-haiku-4-5-20251001" for cheaper/faster
const MAX_TOKENS = 1500;

export default async function handler(req) {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (req.method !== "POST")    return cors(new Response("POST only", { status: 405 }));

  if (!process.env.ANTHROPIC_API_KEY)
    return cors(new Response("Server missing ANTHROPIC_API_KEY", { status: 500 }));

  let body;
  try { body = await req.json(); }
  catch { return cors(new Response("Bad JSON", { status: 400 })); }

  const system = String(body.system || "You are a helpful assistant.");
  const text   = String(body.text || "");
  if (!text.trim()) return cors(new Response("Missing text", { status: 400 }));

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errTxt = await upstream.text().catch(() => "");
    return cors(new Response("Upstream " + upstream.status + " " + errTxt.slice(0, 300), { status: 502 }));
  }

  // Transform Anthropic's SSE into a plain-text stream the app appends directly.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) { controller.close(); return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();                       // keep the partial last line
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const data = l.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        } catch { /* ignore keep-alives / non-JSON */ }
      }
    },
    cancel() { reader.cancel(); },
  });

  return cors(new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8" } }));
}

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");   // tighten to your domain in production
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  return res;
}

// ----------------------------------------------------------------------------
// OPTIONAL: native PDF vision (scanned docs, complex tables). The app currently
// extracts PDF text on-device and sends text, which keeps payloads small and
// works on Edge. To instead send the raw PDF to Claude, post { pdfBase64 } and
// use a Node runtime (larger body limit than Edge), building content as:
//   content: [
//     { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
//     { type: "text", text: instruction }
//   ]
// ----------------------------------------------------------------------------
