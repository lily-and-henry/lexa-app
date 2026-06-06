// ToS Guard - Proxy API
// Deployed on Vercel — your Anthropic key never leaves this server

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Simple in-memory rate limiting (resets per serverless instance)
const rateLimitMap = new Map();
const RATE_LIMIT = 10;        // max requests
const RATE_WINDOW = 60 * 1000; // per 60 seconds per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

export default async function handler(req, res) {
  // CORS — allow the extension and any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 100) {
    return res.status(400).json({ error: 'No valid Terms of Service text provided.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured — API key missing.' });
  }

  const prompt = `You are a legal expert analyzing Terms of Service and Privacy Policies to protect everyday users. Analyze the following Terms of Service text and respond with ONLY valid JSON (no markdown, no explanation outside the JSON).

The JSON must have this exact structure:
{
  "riskScore": <number 0-100, where 100 is most dangerous>,
  "riskLevel": "<one of: LOW, MEDIUM, HIGH, CRITICAL>",
  "redFlags": [<array of strings, max 6, each describing a specific concerning clause>],
  "summary": [<array of 5-7 plain English bullet strings summarizing what the user is agreeing to>],
  "dataCollection": "<one of: Minimal, Standard, Extensive, Invasive>",
  "userRights": "<one of: Strong, Moderate, Limited, Very Limited>",
  "verdict": "<2 sentence plain English verdict for a regular person>",
  "comparedToBenchmark": "<one sentence comparing this to typical/acceptable ToS like Wikipedia or DuckDuckGo>"
}

Terms of Service text to analyze:
---
${text.slice(0, 8000)}
---`;

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      return res.status(502).json({ error: err.error?.message || 'Upstream API error' });
    }

    const data = await upstream.json();
    const raw = data.content[0].text.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(cleaned);

    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
