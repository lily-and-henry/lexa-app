// Para — Feedback & Contact API
// Receives user feedback, contact-form submissions, and chat ratings.
// Submissions are written to the function log (visible in the Vercel
// dashboard under Logs). To keep them permanently, plug in a store here
// (e.g. Vercel KV, a Google Sheet webhook, or a Resend/SendGrid email).

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

const VALID_TYPES = new Set(['feedback', 'contact', 'chat-rating']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait.' });

  const { type, name = '', email = '', topic = '', message = '', rating = null, lang = 'en' } = req.body || {};

  if (!VALID_TYPES.has(type))
    return res.status(400).json({ error: 'Invalid feedback type.' });
  if (type !== 'chat-rating' && (!message || typeof message !== 'string' || message.trim().length < 3))
    return res.status(400).json({ error: 'Please include a message.' });
  if (type === 'chat-rating' && rating !== 'up' && rating !== 'down')
    return res.status(400).json({ error: 'Invalid rating.' });

  const entry = {
    at: new Date().toISOString(),
    type,
    lang,
    name: String(name).slice(0, 100),
    email: String(email).slice(0, 200),
    topic: String(topic).slice(0, 100),
    message: String(message).slice(0, 3000),
    rating
  };

  console.log('[para-feedback]', JSON.stringify(entry));

  return res.status(200).json({ success: true });
};
