const crypto = require('node:crypto');
const voices = new Set(['ko-KR-Wavenet-A','ko-KR-Wavenet-B','ko-KR-Wavenet-C','ko-KR-Wavenet-D']);
function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
const b64 = x => Buffer.from(x).toString('base64url');
let cachedToken = null;
async function tokenFor(account){
  if(cachedToken && cachedToken.email===account.client_email && cachedToken.exp>Date.now()+60000) return cachedToken.value;
  const now=Math.floor(Date.now()/1000);
  const head=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claims=b64(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned=`${head}.${claims}`;
  const signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),account.private_key).toString('base64url');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('auth');const data=await r.json();if(!data.access_token)throw Error('auth');
  cachedToken={email:account.client_email,value:data.access_token,exp:Date.now()+Math.max(0,Number(data.expires_in||3600)-60)*1000};return data.access_token;
}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'지원하지 않는 요청입니다.'});
  const {GOOGLE_TTS_SERVICE_ACCOUNT, TTS_ACCESS_CODE:code}=process.env;
  if(!GOOGLE_TTS_SERVICE_ACCOUNT||!code)return res.status(503).json({error:'AI 목소리 연결을 준비 중이에요. 선생님께 알려 주세요.'});
  const {text,voice,rate,code:entered}=req.body||{};
  if(!equal(entered,code))return res.status(403).json({error:'AI 음성 사용 코드를 확인해 주세요.'});
  if(typeof text!=='string'||!text.trim()||text.length>1000||!voices.has(voice)||typeof rate!=='number'||rate<0.6||rate>1.3)return res.status(400).json({error:'대사는 1,000자 이내로 입력해 주세요.'});
  try {
    const account=JSON.parse(GOOGLE_TTS_SERVICE_ACCOUNT);if(!account.client_email||!account.private_key)throw Error('config');
    const token=await tokenFor(account);
    const r=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({input:{text:text.trim()},voice:{languageCode:'ko-KR',name:voice},audioConfig:{audioEncoding:'MP3',speakingRate:rate}}),signal:AbortSignal.timeout(25000)});
    if(!r.ok){const info=await r.json().catch(()=>({}));const reasons=(info.error?.details||[]).map(x=>x.reason).filter(x=>typeof x==='string'&&/^[A-Z_]+$/.test(x));console.error('TTS_REQUEST_FAILED',r.status,reasons.join(','));throw Error('tts:'+r.status+':'+(reasons[0]||'UNKNOWN'));}const data=await r.json();if(!data.audioContent)throw Error('audio');
    res.setHeader('Content-Type','audio/mpeg');return res.status(200).send(Buffer.from(data.audioContent,'base64'));
  }catch(e){ if(e.message.endsWith(':SERVICE_DISABLED'))return res.status(502).json({error:'Google Cloud에서 Text-to-Speech API 사용 설정이 필요해요.'}); if(/^tts:[0-9]{3}:[A-Z_]+$/.test(e.message))return res.status(502).json({error:'Google 음성 요청에 실패했어요. 서비스 설정을 확인해 주세요.'}); const reason = ['auth','tts','audio','config'].includes(e.message) ? e.message : 'config'; const messages={auth:'Google 인증에 실패했어요. 서비스 계정 설정을 확인해 주세요.',tts:'Google 음성 요청이 실패했어요. API 사용 설정과 결제 계정을 확인해 주세요.',config:'Google 음성 인증 정보의 형식을 확인해 주세요.',audio:'음성 데이터를 받지 못했어요. 다시 시도해 주세요.'}; return res.status(502).json({error:messages[reason]});}
};
