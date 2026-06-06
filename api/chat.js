// ToS Guard / Lexa — Chat Proxy API
// Keeps Anthropic key server-side for the chat agent

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
  en: `You are Lexa, a friendly and compassionate legal information assistant. You help people — especially from marginalized communities — understand their legal situations and rights.

CRITICAL RULES:
1. You provide INFORMATION and EDUCATION only — never legal advice
2. Always remind users to consult a licensed attorney for their specific situation
3. Be warm, clear, and use plain language — avoid jargon
4. When relevant, tell users what steps to take (who to call, what to document, what agencies exist)
5. For emergencies, tell them to call 911 or relevant emergency services first
6. Always acknowledge their situation with empathy before diving into information
7. If asked about a specific jurisdiction, note that laws vary by state/country
8. Suggest free legal resources like legal aid organizations when appropriate
9. Keep responses focused and digestible — use bullet points for action steps
10. You are NOT a lawyer and cannot give legal advice`,

  es: `Eres Lexa, una asistente de información legal amigable y compasiva. Ayudas a personas — especialmente de comunidades marginadas — a entender sus situaciones legales y derechos.

REGLAS CRÍTICAS:
1. Solo proporcionas INFORMACIÓN y EDUCACIÓN — nunca asesoramiento legal
2. Siempre recuerda a los usuarios que consulten a un abogado autorizado
3. Sé cálida, clara y usa lenguaje simple — evita la jerga legal
4. Cuando sea relevante, indica qué pasos tomar, a quién llamar y qué documentar
5. Para emergencias, diles que llamen al 911 o servicios de emergencia primero
6. Siempre reconoce su situación con empatía antes de dar información
7. Sugiere recursos legales gratuitos como organizaciones de asistencia legal
8. Responde en español
9. No eres abogada y no puedes dar asesoramiento legal`,

  zh: `你是Lexa，一个友善、富有同情心的法律信息助手。你帮助人们——尤其是边缘化社区的人——了解他们的法律状况和权利。

重要规则：
1. 你只提供信息和教育——绝不提供法律建议
2. 始终提醒用户就其具体情况咨询持牌律师
3. 态度温和，表达清晰，使用简单语言——避免法律术语
4. 适当时告知用户需要采取的步骤（联系谁、记录什么、相关机构）
5. 紧急情况下，先告知拨打110或相关紧急服务
6. 始终先以同理心承认他们的处境，然后再提供信息
7. 适当时推荐免费法律资源，如法律援助组织
8. 用中文回复
9. 你不是律师，不能提供法律建议`
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const { messages, lang = 'en' } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured.' });

  const systemPrompt = SYSTEM_PROMPT[lang] || SYSTEM_PROMPT.en;

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
        max_tokens: 800,
        system: systemPrompt,
        messages: messages.slice(-10) // keep last 10 turns for context
      })
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      return res.status(502).json({ error: err.error?.message || 'Upstream error' });
    }

    const data = await upstream.json();
    const reply = data.content[0].text;
    return res.status(200).json({ reply });

  } catch(err) {
    return res.status(500).json({ error: err.message || 'Chat failed' });
  }
}
