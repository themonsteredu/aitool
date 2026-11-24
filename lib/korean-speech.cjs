const crypto = require('node:crypto');

let cachedToken;
let pendingToken;

async function requestToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const claims = encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const unsigned = header + '.' + claims;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + signature
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!result.ok) throw Error('auth');
  const data = await result.json();
  if (!data.access_token) throw Error('auth');
  cachedToken = { email: account.client_email, value: data.access_token, exp: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function tokenFor(account) {
  if (cachedToken?.email === account.client_email && cachedToken.exp > Date.now() + 60000) return cachedToken.value;
  if (pendingToken?.email === account.client_email) return pendingToken.promise;
  const promise = requestToken(account);
  pendingToken = { email: account.client_email, promise };
  try {
    return await promise;
  } finally {
    if (pendingToken?.promise === promise) pendingToken = null;
  }
}

async function synthesizeKoreanSpeech(text, voice, rate) {
  const account = JSON.parse(process.env.GOOGLE_TTS_SERVICE_ACCOUNT || '{}');
  if (!account.client_email || !account.private_key) throw Error('config');
  const token = await tokenFor(account);
  const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text }, voice: { languageCode: 'ko-KR', name: voice },
      audioConfig: { audioEncoding: 'MP3', speakingRate: rate }
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) {
    const info = await response.json().catch(() => ({}));
    const reasons = (info.error?.details || []).map(item => item.reason).filter(x => typeof x === 'string' && /^[A-Z_]+$/.test(x));
    console.error('TTS_REQUEST_FAILED', response.status, reasons.join(','));
    throw Error('tts:' + response.status + ':' + (reasons[0] || 'UNKNOWN'));
  }
  const data = await response.json();
  if (!data.audioContent) throw Error('audio');
  return Buffer.from(data.audioContent, 'base64');
}

module.exports = { synthesizeKoreanSpeech };
