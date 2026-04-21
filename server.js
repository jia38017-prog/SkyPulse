// ── SkyPulse Backend ──────────────────────────────────────────────────────────
// Node.js + Express proxy server that keeps the Groq API key server-side.
// The frontend calls /api/ai-weather and /api/ai-chat instead of Groq directly.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));

// Allow requests from the frontend (adjust origin in production)
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || '*', // e.g. 'http://localhost:5500'
  methods: ['GET', 'POST'],
}));

// ── Validate env on startup ───────────────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error('[SkyPulse] ❌  GROQ_API_KEY is not set in .env — AI endpoints will fail.');
} else {
  console.log('[SkyPulse] ✅  GROQ_API_KEY loaded.');
}

// ── Helper: call Groq API ─────────────────────────────────────────────────────
async function callGroq({ messages, maxTokens = 1000, temperature = 0.7 }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages,
      max_tokens:  maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || `Groq API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }

  return res.json();
}

// ── POST /api/ai-weather ──────────────────────────────────────────────────────
// Body: { prompt: string }
// Returns: { reply: string }
app.post('/api/ai-weather', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt is required.' });
  }
  if (prompt.length > 2000) {
    return res.status(400).json({ error: 'prompt is too long.' });
  }

  try {
    const data  = await callGroq({
      messages:   [{ role: 'user', content: prompt.trim() }],
      maxTokens:  180,
      temperature: 0.7,
    });
    const reply = data.choices?.[0]?.message?.content || 'No response.';
    res.json({ reply });
  } catch (err) {
    console.error('[/api/ai-weather]', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── POST /api/ai-chat ─────────────────────────────────────────────────────────
// Body: { system: string, history: Array<{role,content}> }
// Returns: { reply: string }
app.post('/api/ai-chat', async (req, res) => {
  const { system, history } = req.body;

  if (!system || typeof system !== 'string') {
    return res.status(400).json({ error: 'system is required.' });
  }
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history must be a non-empty array.' });
  }

  // Basic safety: cap history to last 20 turns
  const trimmedHistory = history.slice(-20);

  // Validate each message shape
  for (const msg of trimmedHistory) {
    if (!['user', 'assistant'].includes(msg.role) || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Invalid message in history.' });
    }
  }

  try {
    const messages = [
      { role: 'system', content: system.trim() },
      ...trimmedHistory,
    ];
    const data  = await callGroq({ messages, maxTokens: 1000, temperature: 0.7 });
    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't process that.";
    res.json({ reply });
  } catch (err) {
    console.error('[/api/ai-chat]', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SkyPulse] 🚀  Backend running → http://localhost:${PORT}`);
});
