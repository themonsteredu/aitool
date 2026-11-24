const crypto = require('node:crypto');
const voices = new Set(['ko-KR-Wavenet-A','ko-KR-Wavenet-B','ko-KR-Wavenet-C','ko-KR-Wavenet-D']);
function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
const { synthesizeKoreanSpeech } = require('../lib/korean-speech.cjs');
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'지원하지 않는 요청입니다.'});
  const {GOOGLE_TTS_SERVICE_ACCOUNT, TTS_ACCESS_CODE:code}=process.env;
  if(!GOOGLE_TTS_SERVICE_ACCOUNT||!code)return res.status(503).json({error:'AI 목소리 연결을 준비 중이에요. 선생님께 알려 주세요.'});
  const {text,voice,rate,code:entered}=req.body||{};
  if(!equal(entered,code))return res.status(403).json({error:'AI 음성 사용 코드를 확인해 주세요.'});
  if(typeof text!=='string'||!text.trim()||text.length>1000||!voices.has(voice)||typeof rate!=='number'||rate<0.6||rate>1.3)return res.status(400).json({error:'대사는 1,000자 이내로 입력해 주세요.'});
  try {
    const audio = await synthesizeKoreanSpeech(text.trim(), voice, rate);
    res.setHeader('Content-Type','audio/mpeg');return res.status(200).send(audio);
  }catch(e){ if(e.message.endsWith(':SERVICE_DISABLED'))return res.status(502).json({error:'Google Cloud에서 Text-to-Speech API 사용 설정이 필요해요.'}); if(/^tts:[0-9]{3}:[A-Z_]+$/.test(e.message))return res.status(502).json({error:'Google 음성 요청에 실패했어요. 서비스 설정을 확인해 주세요.'}); const reason = ['auth','tts','audio','config'].includes(e.message) ? e.message : 'config'; const messages={auth:'Google 인증에 실패했어요. 서비스 계정 설정을 확인해 주세요.',tts:'Google 음성 요청이 실패했어요. API 사용 설정과 결제 계정을 확인해 주세요.',config:'Google 음성 인증 정보의 형식을 확인해 주세요.',audio:'음성 데이터를 받지 못했어요. 다시 시도해 주세요.'}; return res.status(502).json({error:messages[reason]});}
};
