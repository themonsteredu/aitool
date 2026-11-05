const crypto = require('node:crypto');
const voices = new Set(['ko-KR-SunHiNeural', 'ko-KR-InJoonNeural']);
function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
module.exports = async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'지원하지 않는 요청입니다.'});
  const {AZURE_SPEECH_KEY:key,AZURE_SPEECH_REGION:region,TTS_ACCESS_CODE:code}=process.env;
  if(!key||!region||!code||!/^[a-z0-9-]+$/i.test(region))return res.status(503).json({error:'AI 목소리 연결을 준비 중이에요. 선생님께 알려 주세요.'});
  const {text,voice,rate,code:entered}=req.body||{};
  if(!equal(entered,code))return res.status(403).json({error:'AI 음성 사용 코드를 확인해 주세요.'});
  if(typeof text!=='string'||!text.trim()||text.length>1000||!voices.has(voice)||typeof rate!=='number'||rate<0.6||rate>1.3)return res.status(400).json({error:'대사는 1,000자 이내로 입력해 주세요.'});
  const escaped=text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const ssml=`<speak version="1.0" xml:lang="ko-KR"><voice name="${voice}"><prosody rate="${rate.toFixed(1)}">${escaped}</prosody></voice></speak>`;
  try {
    const response=await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3'},body:ssml,signal:AbortSignal.timeout(25000)});
    if(!response.ok)return res.status(502).json({error:'AI 목소리를 만들지 못했어요. 음성 서비스 설정을 확인해 주세요.'});
    res.setHeader('Content-Type','audio/mpeg');return res.status(200).send(Buffer.from(await response.arrayBuffer()));
  }catch{return res.status(502).json({error:'AI 목소리를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'});}
};
