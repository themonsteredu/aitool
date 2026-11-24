const { createHmac, timingSafeEqual } = require('node:crypto');
const tools = require('../tool-riddle/tools.json');
const { synthesizeKoreanSpeech } = require('../lib/korean-speech.cjs');

const { voices, sample } = require('../tool-riddle/voices.json');
const profiles = new Map(voices.map(profile => [profile.id, profile]));
const byId = new Map(tools.map(tool => [tool.id, tool]));
const cache = new Map();
const day = 86400000;

function readLine(text, profile) {
  return synthesizeKoreanSpeech(text, profile.name, profile.rate);
}

// Keep a generated line identical when the teacher switches voices mid-round.
// A different function instance can verify the line without generating it again.
function signature(toolId, clip, payload) {
  const secret = process.env.GOOGLE_TTS_SERVICE_ACCOUNT;
  if (!secret) return null;
  return createHmac('sha256', secret).update(['riddle-voice-v1', toolId, clip, payload].join('|')).digest('base64url');
}

function lineTicket(toolId, clip, text) {
  const expires = Math.floor(Date.now() / day) + 8;
  const payload = Buffer.from(JSON.stringify([expires, text])).toString('base64url');
  const mac = signature(toolId, clip, payload);
  return mac ? payload + '.' + mac : null;
}

function ticketLine(toolId, clip, ticket) {
  if (typeof ticket !== 'string' || ticket.length > 540) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  const expected = signature(toolId, clip, payload);
  if (!expected || !/^[A-Za-z0-9_-]{43}$/.test(mac) ||
      !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const [expires, text] = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return expires > Math.floor(Date.now() / day) && typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

function validHints(hints, name) {
  return Array.isArray(hints) && hints.length === 2 && hints[0] !== hints[1] &&
    hints.every(line => typeof line === 'string' && line.length >= 8 && line.length <= 68 &&
      /^[가-힣\s.,!?~·]+$/u.test(line) && !line.replace(/\s/g, '').includes(name));
}

async function makePack(tool, token) {
  const fallback = { source: 'classroom', hints: tool.hints };
  if (!token) return fallback;
  try {
    const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4.1-mini', max_tokens: 190,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '초등학교 2학년용 한국어 생활 도구 수수께끼를 출제해요. 주어진 사실만 바탕으로 예문을 새롭게 표현하세요. 첫 힌트는 넓은 쓰임, 둘째는 도구를 구별할 수 있는 모양이나 움직임이에요. 각각 12~48자, 쉽고 자연스러운 한 문장, 일인칭 해요체로 써요. 정답이나 별명, 도구 이름의 어근, 힌트 번호, 영어, 따옴표 속 대사, 물음은 쓰지 마세요. JSON {"hints":["첫 문장","둘째 문장"]}만 반환하세요.' },
          { role: 'user', content: JSON.stringify({ 정답: tool.name, 사실: tool.hints }) }
        ]
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return fallback;
    const body = await response.json();
    const hints = JSON.parse(body.choices?.[0]?.message?.content || '{}').hints;
    if (!validHints(hints, tool.name)) return fallback;
    return { source: 'ai', hints };
  } catch {
    return fallback;
  }
}

async function cached(key, factory) {
  const previous = cache.get(key);
  if (previous && previous.until > Date.now()) return previous.promise;
  for (const [oldKey, value] of cache) {
    if (value.until <= Date.now()) cache.delete(oldKey);
  }
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  const entry = { promise: factory(), until: Date.now() + day };
  cache.set(key, entry);
  try {
    const value = await entry.promise;
    if (value.source === 'classroom') entry.until = Date.now() + 300000;
    return value;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const query = req.query || {};
  const { tool: id, clip, format, ticket } = query;
  const tool = byId.get(id);
  const profile = profiles.get(query.voice === undefined ? 'classic' : query.voice);
  const invalid = () => res.status(400).json({ error: '수업에 있는 도구와 목소리를 골라 주세요.' });
  const sampleRequest = clip === 'sample' && id === undefined;
  if (!profile || (!tool && !sampleRequest) ||
      Object.keys(query).some(key => !['tool', 'voice', 'clip', 'ticket', 'format'].includes(key)) ||
      (format !== undefined && (format !== 'lines' || clip !== undefined)) ||
      (!sampleRequest && clip !== undefined && !['1', '2', 'answer'].includes(clip)) ||
      (ticket !== undefined && !['1', '2'].includes(clip))) return invalid();

  try {
    if (clip) {
      let line;
      if (sampleRequest) line = sample;
      else if (ticket !== undefined) line = ticketLine(id, clip, ticket);
      else if (clip === 'answer') line = '정답은 ' + tool.name + '! 어떤 힌트를 듣고 알았나요?';
      else line = tool.hints[Number(clip) - 1];
      if (!line) return invalid();
      const buffer = await cached('audio:' + profile.id + ':' + line, () => readLine(line, profile));
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(buffer);
    }
    const token = process.env.AI_GATEWAY_API_KEY || (process.env.VERCEL && req.headers['x-vercel-oidc-token']) || process.env.VERCEL_OIDC_TOKEN;
    const pack = await cached('hints:' + id, () => makePack(tool, token));
    let result = pack;
    if (pack.source === 'ai' && process.env.GOOGLE_TTS_SERVICE_ACCOUNT) {
      if (format === 'lines') {
        result = { ...pack, tickets: pack.hints.map((line, i) => lineTicket(id, String(i + 1), line)) };
      } else {
        // Already-open classrooms using the original client expect embedded audio.
        const audio = await Promise.all(pack.hints.map(line =>
          cached('audio:' + profile.id + ':' + line, () => readLine(line, profile))
            .then(buf => buf.toString('base64')).catch(() => null)));
        result = { ...pack, audio };
      }
    }
    res.setHeader('Cache-Control', pack.source === 'ai'
      ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
      : 'public, max-age=60, s-maxage=300');
    return res.status(200).json(result);
  } catch {
    return res.status(503).json({ error: '지금은 로봇 소리를 불러올 수 없어요.' });
  }
};
