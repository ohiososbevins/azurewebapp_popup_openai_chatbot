import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { franc } from 'franc-min';

// ── Language mapping (for “reply in the same language”) ────────────────────────
const LANG_MAP = {
  eng: { name: 'English' },
  spa: { name: 'Spanish' },
  zho: { name: 'Chinese' },
  yue: { name: 'Cantonese' },
  vie: { name: 'Vietnamese' },
  tgl: { name: 'Tagalog' },
  ara: { name: 'Arabic' },
  fra: { name: 'French' },
  rus: { name: 'Russian' },
  kor: { name: 'Korean' },
  deu: { name: 'German' },
  ita: { name: 'Italian' },
  por: { name: 'Portuguese' },
  jpn: { name: 'Japanese' },
  pol: { name: 'Polish' },
  hin: { name: 'Hindi' },
  guj: { name: 'Gujarati' },
  ben: { name: 'Bengali' },
  pan: { name: 'Punjabi' },
  urd: { name: 'Urdu' },
  ukr: { name: 'Ukrainian' },
  heb: { name: 'Hebrew' },
  ell: { name: 'Greek' },
  tha: { name: 'Thai' },
  khm: { name: 'Khmer' },
  lao: { name: 'Lao' },
  som: { name: 'Somali' },
  hmn: { name: 'Hmong' },
  tam: { name: 'Tamil' },
  amh: { name: 'Amharic' },
  tur: { name: 'Turkish' },
  per: { name: 'Persian (Farsi)' },
  pas: { name: 'Pashto' },
};

// ────────────────────────────────────────────────────────────────────────────────
// Boilerplate Setup
// ────────────────────────────────────────────────────────────────────────────────
console.log('*** Starting RAG Server ***');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure a writable temp directory
const tempDir = '/home/temp';
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
process.env.TMPDIR = tempDir;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// ─── SPEECH-ENABLED ENDPOINT (optional) ────────────────────────────────────────
app.get('/speech-enabled', (req, res) => {
  res.json({ enabled: process.env.ENABLE_SPEECH === 'true' });
});

// ─── AZURE OPENAI EMBEDDING HELPER ─────────────────────────────────────────────
async function getQueryEmbedding(query) {
  const url = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_EMBEDDING_MODEL}/embeddings?api-version=2023-06-01-preview`;
  const { data } = await axios.post(
    url,
    { input: query },
    {
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.AZURE_OPENAI_API_KEY,
      },
    }
  );
  return data.data[0].embedding;
}

// ─── AZURE AI SEARCH (SEMANTIC + VECTOR; no answers/captions) ─────────────────
async function searchAzureAISearch(query, topK) {
  const endpoint = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2023-07-01-preview`;

  // We are not sending "answers" or "captions" here.
  const body = {
    queryType: 'semantic',
    queryLanguage: 'en-us',
    semanticConfiguration: process.env.AZURE_SEMANTIC_CONFIGURATION?.trim() || 'default',
    search: query,
    top: topK,
  };

  let vectorUsed = false;
  if (process.env.USE_VECTOR_SEARCH === 'true') {
    try {
      const embedding = await getQueryEmbedding(query);
      body.vector = { value: embedding, fields: 'embedding', k: topK };
      vectorUsed = true;
    } catch (err) {
      console.warn('Vector embedding failed; falling back to semantic only.', err);
    }
  }

  if (process.env.DEBUG_LOGGING === 'true') {
    console.log('🔍 Search payload:', JSON.stringify({ ...body, vector: '<<omitted>>' }, null, 2));
  }

  const { data } = await axios.post(endpoint, body, {
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.AZURE_SEARCH_KEY,
    },
  });

  return { results: data.value || [], vectorUsed };
}

// ─── /chat ENDPOINT ───────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  const maxTurns = parseInt(process.env.MAX_TURNS) || 3;
  const topK = parseInt(process.env.TOP_K) || 5; // default to 5 results
  const max_tokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 300;
  const MAX_SOURCE_CHARACTERS = parseInt(process.env.MAX_SOURCE_CHARACTERS) || 20000;
  const FALLBACK_MESSAGE = process.env.FALLBACK_MESSAGE?.trim() ||
    "I'm sorry, but I couldn't find the answer to that question in the documents available to this agency.";

  // ─── 1) Detect user language (for “reply in same language”) ────────────────
  let detectedLang = franc(message || '');
  if (!LANG_MAP[detectedLang]) detectedLang = 'eng';
  const userLangName = LANG_MAP[detectedLang].name;

  try {
    // ─── 2) Query Azure Search (no answers/captions) ─────────────────────────
    const { results: searchResults, vectorUsed } = await searchAzureAISearch(message, topK);

    // ─── 3) If searchResults is empty, immediately return fallback + no citations
    if (searchResults.length === 0) {
      const reply = FALLBACK_MESSAGE;
      return res.json({
        vectorUsed: false,
        reply,
        assistantMessage: { role: 'assistant', content: reply },
        citations: []
      });
    }

    // ─── 4) Build “sources” array from top hits ───────────────────────────────
    let sources = searchResults.map(doc => {
      let c = doc.content || '';
      if (c.length > MAX_SOURCE_CHARACTERS) {
        const t = c.slice(0, MAX_SOURCE_CHARACTERS);
        const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf('\n'), t.lastIndexOf(' '));
        c = t.slice(0, last + 1).trim() + ' [...]';
      }
      return `Source: ${doc.url}\n${c}`;
    }).join('\n\n---\n\n');

    // ─── 5) Build system prompt with “reply in same language” rule ─────────────
    let baseInstructions = process.env.AZURE_OPENAI_INSTRUCTIONS || 'You are a helpful assistant.';
    if (!/language/i.test(baseInstructions)) {
      baseInstructions =
        `▪ Language rule – Always reply in the same language as the user's question (${userLangName}).\n\n`
        + baseInstructions;
    }
    const basePrompt =
      `${baseInstructions}\n\nUse only the info from sources. If no answer, say you don’t know.\n\n`;

    // Trim sources if exceeding token budget
    const maxInputTokens = 3000;
    const est = (basePrompt.length + sources.length) / 4;
    let sourcesTrimmed = sources;
    if (est > maxInputTokens) {
      const allowed = maxInputTokens * 4 - basePrompt.length;
      const t = sources.slice(0, allowed);
      const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf('\n'), t.lastIndexOf(' '));
      sourcesTrimmed = t.slice(0, last + 1).trim() + ' [...]';
    }

    const prompt = basePrompt + sourcesTrimmed;
    const trimmedHistory = history.slice(-maxTurns * 2);
    const messages = [
      { role: 'system', content: prompt },
      ...trimmedHistory
      // Do not re-append the user’s latest turn, because `history` already includes it.
    ];

    // ─── 6) Call Azure OpenAI chat completion ─────────────────────────────────
    const chatRes = await axios.post(
      `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2023-05-15`,
      { messages, temperature: 0.7, max_tokens },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.AZURE_OPENAI_API_KEY
        }
      }
    );
    const reply = chatRes.data.choices[0].message.content;

    // ─── 7) Build citations list from searchResults ───────────────────────────
    const seen = new Set();
    const citationLinks = [];
    for (const doc of searchResults) {
      const uLower = doc.url.toLowerCase();
      if (!seen.has(uLower)) {
        seen.add(uLower);
        citationLinks.push(`<a href="${doc.url}" target="_blank">Citation ${citationLinks.length + 1}</a>`);
      }
      if (citationLinks.length >= topK) break;
    }

    res.json({
      vectorUsed,
      reply,
      assistantMessage: { role: 'assistant', content: reply },
      citations: citationLinks
    });
  } catch (err) {
    console.error('❌ Unexpected error in /chat:', err);
    res.status(500).json({ error: true, reply: '⚠️ An unexpected error occurred. Check server logs.' });
  }
});

// ─── SPEECH TOKEN ENDPOINT ─────────────────────────────────────────────────────
app.get('/speech-token', async (req, res) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return res.status(500).json({ error: 'Speech service credentials missing' });
  }
  try {
    const response = await axios.post(
      `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      null,
      {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    res.json({ token: response.data, region });
  } catch (err) {
    console.error('Speech token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch speech token' });
  }
});

// ─── CONFIG ENDPOINT ───────────────────────────────────────────────────────────
app.get('/config', (req, res) => {
  res.json({ fallbackMessage: process.env.FALLBACK_MESSAGE?.trim() || '' });
});

// ─── STATIC FILES & SPA FALLBACK ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START SERVER ──────────────────────────────────────────────────────────────
app.listen(port, () => console.log(`🚀 Server listening on http://localhost:${port}`));
