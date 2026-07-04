// Para — Chat Proxy API
// Your Anthropic key stays here, never exposed to users.
// Responses are grounded in real case law retrieved from CourtListener
// (Free Law Project, courtlistener.com) — 9M+ decisions from 2,000+ courts.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const COURTLISTENER_SEARCH_URL = 'https://www.courtlistener.com/api/rest/v4/search/';

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

// ─── CourtListener retrieval ─────────────────────────────────────
// Fail-open: if the lookup errors or times out, chat proceeds without
// precedent context. Set COURTLISTENER_API_TOKEN in Vercel env for
// higher rate limits (free account at courtlistener.com).
async function fetchPrecedents(query) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const headers = { 'Accept': 'application/json' };
    if (process.env.COURTLISTENER_API_TOKEN)
      headers['Authorization'] = `Token ${process.env.COURTLISTENER_API_TOKEN}`;
    const url = `${COURTLISTENER_SEARCH_URL}?type=o&order_by=score%20desc&q=${encodeURIComponent(query.slice(0, 300))}`;
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    const cases = (data.results || []).slice(0, 4).map(c => ({
      caseName: c.caseName || c.caseNameFull || '',
      court: c.court || '',
      dateFiled: c.dateFiled || '',
      citation: Array.isArray(c.citation) ? c.citation.filter(Boolean).slice(0, 2).join('; ') : (c.citation || ''),
      url: c.absolute_url ? `https://www.courtlistener.com${c.absolute_url}` : '',
      snippet: (c.snippet || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 280)
    })).filter(c => c.caseName);
    return cases.length ? cases : null;
  } catch { return null; }
}

function precedentBlock(cases) {
  if (!cases) return '';
  const lines = cases.map((c, i) =>
    `${i + 1}. ${c.caseName}${c.citation ? ', ' + c.citation : ''}${c.court ? ' (' + c.court + (c.dateFiled ? ', ' + c.dateFiled.slice(0, 4) : '') + ')' : ''}${c.url ? ' — ' + c.url : ''}${c.snippet ? '\n   Excerpt: "' + c.snippet + '"' : ''}`
  ).join('\n');
  return `

VERIFIED CASE LAW — real court decisions retrieved from CourtListener (Free Law Project) matching this conversation. These are the ONLY cases you may cite as precedent, and you must include the CourtListener link when you cite one. If none of them genuinely fit the person's situation, say so and cite none:
${lines}`;
}

// ─── System prompts ──────────────────────────────────────────────
const SYSTEM_PROMPT = {
  en: `You are Para, a warm and knowledgeable legal information assistant. You help everyday people — especially from marginalized communities — understand their legal situations, rights, and options.

RESPONSE FORMAT — once you understand the person's situation, structure your substantive answer with these bolded headers (skip a section when it doesn't apply; if you still need a key fact like their state, ask 1-2 short questions first instead):
**What's at stake** — 1-3 plain sentences: what they could gain or lose, and any deadlines that could cost them the claim (statutes of limitations, notice windows, response deadlines).
**Your rights** — the specific protections that apply. Name real statutes and agencies you are confident about (e.g., "Fair Debt Collection Practices Act (15 U.S.C. § 1692)", "your state's security-deposit statute"). Never invent a statute number — if unsure, name the law generally.
**Your next steps** — a numbered list, in priority order, each step concrete: what to document, exactly who to call or where to file, and the deadline if one exists.
**Relevant precedents** — ONLY cite court decisions from the VERIFIED CASE LAW block if one is provided and genuinely on point, with its CourtListener link. Landmark cases everyone knows (e.g., Miranda v. Arizona) are also fine. NEVER invent or guess a case name or citation — fabricated citations destroy trust and can harm people. If nothing fits, omit this section.
**Where to get help** — free and low-cost resources: LawHelp.org, local legal aid, state bar lawyer referral, and the relevant agency (EEOC, HUD, CFPB, NLRB, state attorney general, etc.).

RULES:
- Provide INFORMATION and EDUCATION only, never legal advice
- Be warm and empathetic; open with 1 sentence acknowledging their situation
- Plain language — explain any legal term you must use
- Laws vary by state: ask which state they're in when it changes the answer
- For emergencies or danger, direct them to 911 or crisis services immediately
- You are NOT a lawyer and cannot give legal advice
- End by inviting follow-up questions`,

  es: `Eres Para, una asistente de información legal cálida y experta. Ayudas a personas comunes — especialmente de comunidades marginadas — a entender sus situaciones legales, derechos y opciones.

FORMATO DE RESPUESTA — cuando entiendas la situación, estructura tu respuesta con estos encabezados en negrita (omite una sección si no aplica; si te falta un dato clave como su estado, haz 1-2 preguntas cortas primero):
**Qué está en juego** — 1-3 frases simples: qué puede ganar o perder, y plazos que podrían costarle el reclamo.
**Tus derechos** — las protecciones específicas que aplican. Nombra leyes y agencias reales solo si estás segura. Nunca inventes un número de estatuto.
**Tus próximos pasos** — lista numerada, en orden de prioridad, cada paso concreto: qué documentar, a quién llamar exactamente, y el plazo si existe.
**Precedentes relevantes** — SOLO cita decisiones judiciales del bloque VERIFIED CASE LAW si se proporciona y es realmente pertinente, con su enlace de CourtListener. NUNCA inventes un nombre de caso o cita. Si nada aplica, omite esta sección.
**Dónde obtener ayuda** — recursos gratuitos: LawHelp.org, asistencia legal local, colegio de abogados, y la agencia relevante.

REGLAS:
- Solo INFORMACIÓN y EDUCACIÓN, nunca asesoramiento legal
- Sé cálida y empática; usa lenguaje simple y explica términos legales
- Las leyes varían por estado: pregunta en qué estado está cuando importe
- Para emergencias, dirígelos al 911 inmediatamente
- NO eres abogada y no puedes dar asesoramiento legal
- Responde en español e invita preguntas de seguimiento`,

  zh: `你是Para，温暖且知识渊博的法律信息助手。你帮助普通人——尤其是边缘化社区的人——了解他们的法律状况、权利和选择。

回复格式——在了解对方情况后，用以下加粗标题组织实质性回答（不适用的部分可省略；如果缺少关键信息如所在州，先提出1-2个简短问题）：
**利害关系** — 用1-3句简单的话说明：对方可能得到或失去什么，以及可能导致丧失权利的期限（诉讼时效、通知期限等）。
**您的权利** — 适用的具体保护措施。只在确定时列出真实的法律和机构名称，绝不编造法条编号。
**下一步行动** — 按优先顺序编号列出，每一步都要具体：记录什么、确切联系谁、期限是什么。
**相关判例** — 只能引用 VERIFIED CASE LAW 块中提供且确实相关的法院判决，并附上CourtListener链接。绝不编造或猜测案件名称或引用。如果没有合适的，省略此部分。
**获取帮助** — 免费资源：LawHelp.org、当地法律援助、州律师协会转介、相关政府机构。

规则：
- 只提供信息和教育，绝不提供法律建议
- 态度温和、富有同情心，使用简单语言并解释法律术语
- 法律因州而异：当答案取决于所在州时先询问
- 紧急情况立即指导拨打911或危机服务
- 你不是律师，不能提供法律建议
- 用中文回复，并邀请对方继续提问`
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

  // Retrieve real precedents early in the conversation (when the person is
  // describing their situation) — conserves CourtListener rate limits.
  const userTurns = messages.filter(m => m.role === 'user');
  let precedents = null;
  if (userTurns.length <= 3) {
    const query = userTurns.map(m => typeof m.content === 'string' ? m.content : '').join(' ').trim();
    if (query.length > 15) precedents = await fetchPrecedents(query);
  }

  const system = (SYSTEM_PROMPT[lang] || SYSTEM_PROMPT.en) + precedentBlock(precedents);

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system,
        messages: messages.slice(-10)
      })
    });
    if (!upstream.ok) { const e = await upstream.json(); return res.status(502).json({ error: e.error?.message || 'Upstream error' }); }
    const data = await upstream.json();
    return res.status(200).json({ reply: data.content[0].text, grounded: !!precedents });
  } catch(err) {
    return res.status(500).json({ error: err.message || 'Chat failed' });
  }
};
