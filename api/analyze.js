// Para — Document Analysis Proxy
// Your Anthropic key stays here, never exposed to users

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait.' });

  const { text, lang = 'en' } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 100)
    return res.status(400).json({ error: 'No valid document text provided.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured.' });

  const langLabel = lang === 'es' ? 'Spanish' : lang === 'zh' ? 'Chinese (Simplified)' : 'English';
  const prompt = `You are a legal expert analyzing Terms of Service, contracts, and Privacy Policies to protect everyday users. Analyze the following text and respond with ONLY valid JSON — no markdown, no explanation outside the JSON.

Required JSON structure:
{
  "riskScore": <0-100, higher = more dangerous>,
  "riskLevel": "<LOW | MEDIUM | HIGH | CRITICAL>",
  "redFlags": [<up to 6 strings describing concerning clauses>],
  "summary": [<5-7 plain language bullets of what the user is agreeing to>],
  "dataCollection": "<Minimal | Standard | Extensive | Invasive>",
  "userRights": "<Strong | Moderate | Limited | Very Limited>",
  "verdict": "<2 plain-language sentences for a regular person>",
  "comparedToBenchmark": "<1 sentence comparing to typical acceptable ToS>",
  "stakes": "<2-3 plain sentences: what the user concretely risks by agreeing — worst realistic outcomes, what rights they sign away, what it could cost them>",
  "nextSteps": [<3-5 concrete actions to take before or after agreeing, in priority order — e.g. what to negotiate, what to screenshot, opt-outs to exercise with the exact setting/form name if the document mentions one, deadlines to calendar>],
  "relevantLaw": [<up to 3 strings, each naming a REAL law or regulation that governs clauses like these and one phrase on why it matters here — e.g. "CCPA (California): gives you the right to demand deletion of collected data". Only name laws you are certain exist. NEVER invent case names or statute numbers — omit rather than guess.>]
}

Respond in ${langLabel} for all text fields except JSON keys.

Document:
---
${text.slice(0, 9000)}
---`;

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });
    if (!upstream.ok) { const e = await upstream.json(); return res.status(502).json({ error: e.error?.message || 'Upstream error' }); }
    const data = await upstream.json();
    const raw = data.content[0].text.trim().replace(/^```json\s*/i,'').replace(/```\s*$/i,'').trim();
    const result = JSON.parse(raw);
    return res.status(200).json({ success: true, result });
  } catch(err) {
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
};
