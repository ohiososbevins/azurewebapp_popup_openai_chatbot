import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Writable Temp Directory Setup ─────────────────────────────────────────────
const tempDir = '/home/temp';
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}
process.env.TMPDIR = tempDir;

const app = express();
const port = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors());

//GGLE ENDPOINT ────────────────────────────────────────────────────
app.get('/speech-enabled', (req, res) => {
    res.json({ enabled: process.env.ENABLE_SPEECH === 'true' });
});

// ─── AZURE QUERY EMBEDDING HELPER ──────────────────────────────────────────────
async function getQueryEmbedding(query) {
    const url = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_EMBEDDING_MODEL}/embeddings?api-version=2023-06-01-preview`;
    const { data } = await axios.post(url, { input: query }, {
        headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.AZURE_OPENAI_API_KEY
        }
    });
    return data.data[0].embedding;
}

// ─── AZURE AI SEARCH (SEMANTIC + VECTOR) ───────────────────────────────────────
async function searchAzureAISearch(query, topK) {
    const endpoint = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2023-07-01-preview`;
    const body = {
        queryType: 'semantic',
        queryLanguage: 'en-us',
        semanticConfiguration: process.env.AZURE_SEMANTIC_CONFIGURATION,
        search: query,
        top: topK
    };

    let vectorUsed = false;
    if (process.env.USE_VECTOR_SEARCH === 'true') {
        try {
            const embedding = await getQueryEmbedding(query);
            console.log('🔍 Using vector search; embedding length:', embedding.length);
            body.vector = { value: embedding, fields: 'embedding', k: topK };
            vectorUsed = true;

            const preview = embedding.slice(0, 5).map(v => v.toFixed(4));
            console.log(`🔍 Vector preview: [${preview.join(', ')}]...`);
        } catch (err) {
            console.warn('Vector embedding failed, falling back to semantic only.', err);
        }
    }

    if (process.env.DEBUG_LOGGING === 'true') {
        console.log('🔍 Search payload:', JSON.stringify({ ...body, vector: '<<omitted>>' }, null, 2));
    }

    const { data } = await axios.post(endpoint, body, {
        headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.AZURE_SEARCH_KEY
        }
    });

    return { results: data.value || [], vectorUsed };
}

// ─── CHAT ENDPOINT ─────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    const maxTurns = parseInt(process.env.MAX_TURNS) || 3;
    const topK = parseInt(process.env.TOP_K) || 3;
    const max_tokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 300;
    const MAX_SOURCE_CHARACTERS = parseInt(process.env.MAX_SOURCE_CHARACTERS) || 600;
    const FALLBACK_MESSAGE = process.env.FALLBACK_MESSAGE?.trim() ||
        "I'm sorry, but I couldn't find the answer.";

    try {
        const { results: searchResults, vectorUsed } = await searchAzureAISearch(message, topK);

        let sources = searchResults.map(doc => {
            let c = doc.content;
            if (c.length > MAX_SOURCE_CHARACTERS) {
                const t = c.slice(0, MAX_SOURCE_CHARACTERS);
                const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf('\n'), t.lastIndexOf(' '));
                c = t.slice(0, last + 1).trim() + ' [...]';
            }
            return `Source: ${doc.url}\n${c}`;
        }).join('\n\n---\n\n');

        const systemPrompt = process.env.AZURE_OPENAI_INSTRUCTIONS || 'You are a helpful assistant.';
        const base = `${systemPrompt}\n\nUse only the info from sources. If no answer, say you don’t know.\n\n`;
        const maxInputTokens = 3000;
        const est = (base.length + sources.length) / 4;
        if (est > maxInputTokens) {
            const allowed = maxInputTokens * 4 - base.length;
            const t = sources.slice(0, allowed);
            const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf('\n'), t.lastIndexOf(' '));
            sources = t.slice(0, last + 1).trim() + ' [...]';
        }
        const prompt = base + sources;
        const trimmedHistory = history.slice(-maxTurns * 2);
        const messages = [
            { role: 'system', content: prompt },
            ...trimmedHistory,
            { role: 'user', content: message }
        ];

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
        const citationLinks = Array.from(new Set(searchResults.map(d => d.url)))
            .slice(0, topK)
            .map((url, i) => `<a href="${url}" target="_blank">Citation ${i+1}</a>`);

        const norm = str => str.replace(/<[^>]+>/g, '').toLowerCase();
        const isFallback = norm(reply).includes(
            FALLBACK_MESSAGE.split('.')[0].toLowerCase()
        );
        if (isFallback) console.log('🔍 No-answer detected. Citations suppressed.');

        res.json({ vectorUsed, reply, assistantMessage: { role: 'assistant', content: reply }, citations: isFallback ? [] : citationLinks });
    } catch (err) {
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message || err.message;
        if (status === 429) {
            return res.status(429).json({ error: true, reply: '⏳ Too many requests. Please try again soon.' });
        }
        console.error('❌ Chat error:', msg);
        res.status(500).json({ error: true, reply: '⚠️ An error occurred while generating a response.' });
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
