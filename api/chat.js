// Para — Chat Proxy API
// Your Anthropic key stays here, never exposed to users

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const rateLimitMap = new Map();
const RATE_LIMIT = 30;
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

const SYSTEM_PROMPT = {
  en: `You are Para, a warm and knowledgeable legal information assistant. You help everyday people — especially from marginalized communities — understand their legal situations, rights, and options.

RULES:
- Provide INFORMATION and EDUCATION only, never legal advice
- Be warm, empathetic, use plain language — no jargon
- Start by acknowledging the person's situation with empathy
- Give clear actionable next steps: who to call, what to document, what agencies exist
- For emergencies, direct them to 911 or relevant services immediately
- Note that laws vary by state/country when relevant
- Suggest free legal resources (legal aid, pro bono clinics) when appropriate
- Use bullet points for action steps
- You are NOT a lawyer and cannot give legal advice`,

  es: `Eres Para, una asistente de información legal cálida y experta. Ayudas a personas comunes a entender sus situaciones legales, derechos y opciones.

REGLAS:
- Solo información y educación, nunca asesoramiento legal
- Sé cálida, empática, usa lenguaje simple
- Comienza reconociendo la situación con empatía
- Da pasos claros: a quién llamar, qué documentar, qué agencias existen
- Para emergencias, dirígelos al 911 inmediatamente
- Sugiere recursos legales gratuitos cuando sea apropiado
- Responde en español`,

  zh: `你是Para，温暖且知识渊博的法律信息助手。帮助普通人了解法律状况、权利和选择。

规则：
- 只提供信息和教育，绝不提供法律建议
- 态度温和、富有同情心，使用简单语言
- 先以同理心承认对方的处境
- 给出清晰可操作的下一步
- 紧急情况立即指导拨打110
- 推荐免费法律援助资源
- 用中文回复`
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait.' });

  const { messages, lang = 'en' } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'No messages provided.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured.' });

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: SYSTEM_PROMPT[lang] || SYSTEM_PROMPT.en,
        messages: messages.slice(-10)
      })
    });
    if (!upstream.ok) { const e = await upstream.json(); return res.status(502).json({ error: e.error?.message || 'Upstream error' }); }
    const data = await upstream.json();
    return res.status(200).json({ reply: data.content[0].text });
  } catch(err) {
    return res.status(500).json({ error: err.message || 'Chat failed' });
  }
};
