
const $=id=>document.getElementById(id);
const video=$("video"), overlay=$("overlay"), ctx=overlay.getContext("2d",{willReadFrequently:true});
const chart=$("chart"), cctx=chart.getContext("2d");
let stream=null, loopStarted=false, measuring=false;
let rpm=0, maxRpm=0, stableMaxRpm=0, lastRawAngle=null, unwrappedAngle=0, angleHist=[], lastCenter=null, lastBlob=null;
let samples=[], frameTimes=[], measuredFps=0, reliableMaxRpm=0, frameIndex=0, logs=[];
let currentPhase="IDLE", lastFeature=null, confidence=0;
let lastDeltaRad=0,lastDeltaDeg=0,lastCalcRpm=0,lastRejectReason="-",lastUnwrapDeg=0,lastAccepted=false;
let snapshots=[],lastSnapshotAt=0;
const defaults={yellowMin:80,blackMax:105,searchRadius:40,innerRate:16,fitWindow:260,maxValid:1200,minBlob:10,snapshotRpm:650}, settings={...defaults};
for(const k in settings){settings[k]=Number(localStorage.getItem("ono_spin_"+k)??defaults[k]);const el=$(k);if(el)el.value=settings[k];}
function bind(k,suffix=""){const el=$(k),v=$(k+"V");const upd=()=>{settings[k]=Number(el.value);localStorage.setItem("ono_spin_"+k,settings[k]);v.textContent=settings[k]+suffix};el.addEventListener("input",upd);upd();}
bind("yellowMin");bind("blackMax");bind("searchRadius","%");bind("innerRate","%");bind("fitWindow");bind("maxValid");bind("minBlob");bind("snapshotRpm");
$("resetSettings").onclick=()=>{for(const k in defaults)localStorage.removeItem("ono_spin_"+k);location.reload();};
function resize(){const b=overlay.parentElement.getBoundingClientRect();overlay.width=Math.max(1,Math.round(b.width));overlay.height=Math.max(1,Math.round(b.height));chart.width=Math.round(chart.getBoundingClientRect().width*devicePixelRatio);chart.height=Math.round(170*devicePixelRatio);}window.addEventListener("resize",resize);
function setPhase(p){currentPhase=p;$("phaseBadge").textContent=p;$("phaseBadge").classList.toggle("on",p!=="IDLE");}
async function initCamera(){
 try{
  $("status").textContent="カメラ起動中...";
  if(!window.isSecureContext){
   throw new Error("NOT_SECURE_CONTEXT: カメラはHTTPSまたはlocalhostでのみ起動できます。file:// や http:// では起動できません。");
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
   throw new Error("NO_GET_USER_MEDIA: このブラウザはカメラAPIに対応していません。Chromeで開いてください。");
  }
  if(stream){try{stream.getTracks().forEach(t=>t.stop());}catch(e){} stream=null;}
  const tries=[
   {video:{facingMode:{ideal:"environment"},width:{ideal:320},height:{ideal:240},frameRate:{ideal:120,max:120}},audio:false},
   {video:{facingMode:{ideal:"environment"},width:{ideal:320},height:{ideal:240},frameRate:{ideal:60,max:60}},audio:false},
   {video:{facingMode:{ideal:"environment"},width:{ideal:480},height:{ideal:360},frameRate:{ideal:60}},audio:false},
   {video:{facingMode:{ideal:"environment"},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}},audio:false},
   {video:{facingMode:{ideal:"environment"}},audio:false},
   {video:true,audio:false}
  ];
  let lastErr=null;
  for(const c of tries){
   try{stream=await navigator.mediaDevices.getUserMedia(c);break;}
   catch(e){lastErr=e;}
  }
  if(!stream)throw lastErr || new Error("UNKNOWN_CAMERA_ERROR");
  video.srcObject=stream;
  video.setAttribute("playsinline","");
  video.muted=true;
  await video.play();
  resize();
  const track=stream.getVideoTracks()[0];
  const st=track&&track.getSettings?track.getSettings():{};
  $("status").textContent=`カメラ起動OK。${st.width||"?"}x${st.height||"?"} / fps目安 ${st.frameRate?Math.round(st.frameRate):"?"}。黄色スピナーを円内に入れてください。`;
  if(!loopStarted){loopStarted=true;requestAnimationFrame(loop);}
 }catch(e){
  const msg=(e&&e.message)?e.message:String(e);
  $("status").textContent="カメラ起動失敗："+msg+"　※スマホではGitHub Pages等のHTTPSで開いてください。";
 }
}
$("cameraBtn").onclick=initCamera;
$("measureBtn").onclick=()=>{measuring=true;setPhase("TRACKING");rpm=0;lastRawAngle=null;unwrappedAngle=0;angleHist=[];samples=[];logs=[];snapshots=[];frameIndex=0;lastDeltaRad=0;lastDeltaDeg=0;lastCalcRpm=0;lastRejectReason="-";$("status").textContent="計測中。1000rpm評価のため、明るい場所でスピナーを回してください。";};
$("stopBtn").onclick=()=>{measuring=false;setPhase("IDLE");$("status").textContent="停止しました。ログを保存できます。";};
$("resetBtn").onclick=()=>{maxRpm=0;stableMaxRpm=0;$("maxRpm").textContent="0";};
function normalize(d){while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;}
function isYellow(r,g,b){return r>settings.yellowMin&&g>settings.yellowMin&&b<settings.yellowMin*.9&&(r-b)>45&&(g-b)>35&&Math.abs(r-g)<95;}
function isBlack(r,g,b){const br=(r+g+b)/3;return br<settings.blackMax&&r<settings.blackMax+18&&g<settings.blackMax+18&&b<settings.blackMax+18;}
function detectBlackWeight(w,h){const cx0=w/2,cy0=h/2,sr=Math.min(w,h)*(settings.searchRadius/100);const img=ctx.getImageData(0,0,w,h),data=img.data;let sx=0,sy=0,sw=0,cnt=0;for(let y=Math.max(0,Math.floor(cy0-sr));y<Math.min(h,Math.ceil(cy0+sr));y+=4){for(let x=Math.max(0,Math.floor(cx0-sr));x<Math.min(w,Math.ceil(cx0+sr));x+=4){const dx=x-cx0,dy=y-cy0;if(dx*dx+dy*dy>sr*sr)continue;const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(isYellow(r,g,b)){const wt=(r+g)/2-b;sx+=x*wt;sy+=y*wt;sw+=wt;cnt++;}}}
let cx=cx0,cy=cy0,radius=sr*.72;if(sw>0&&cnt>25){cx=sx/sw;cy=sy/sw;let sumR=0,rc=0;for(let y=Math.max(0,Math.floor(cy0-sr));y<Math.min(h,Math.ceil(cy0+sr));y+=8){for(let x=Math.max(0,Math.floor(cx0-sr));x<Math.min(w,Math.ceil(cx0+sr));x+=8){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(isYellow(r,g,b)){sumR+=Math.hypot(x-cx,y-cy);rc++;}}}if(rc>0)radius=Math.min(sr*1.05,Math.max(45,sumR/rc*1.9));lastCenter={x:cx,y:cy,r:radius};}else if(lastCenter){cx=lastCenter.x;cy=lastCenter.y;radius=lastCenter.r;}
const inner=radius*(settings.innerRate/100),scale=4,x0=Math.max(0,Math.floor(cx-radius)),x1=Math.min(w-1,Math.ceil(cx+radius)),y0=Math.max(0,Math.floor(cy-radius)),y1=Math.min(h-1,Math.ceil(cy+radius)),gw=Math.ceil((x1-x0+1)/scale),gh=Math.ceil((y1-y0+1)/scale);const mask=new Uint8Array(gw*gh);for(let gy=0;gy<gh;gy++){const y=y0+gy*scale;for(let gx=0;gx<gw;gx++){const x=x0+gx*scale,dx=x-cx,dy=y-cy,rr=dx*dx+dy*dy;if(rr>radius*radius||rr<inner*inner)continue;const i=(y*w+x)*4;if(isBlack(data[i],data[i+1],data[i+2]))mask[gy*gw+gx]=1;}}
const seen=new Uint8Array(gw*gh),comps=[],qx=[],qy=[];for(let gy=0;gy<gh;gy++){for(let gx=0;gx<gw;gx++){const idx=gy*gw+gx;if(!mask[idx]||seen[idx])continue;qx.length=0;qy.length=0;qx.push(gx);qy.push(gy);seen[idx]=1;let area=0,bx=0,by=0,score=0,minx=9999,maxx=-1,miny=9999,maxy=-1;while(qx.length){const xg=qx.pop(),yg=qy.pop(),px=x0+xg*scale,py=y0+yg*scale,i=(py*w+px)*4,br=(data[i]+data[i+1]+data[i+2])/3,wt=255-br;area++;bx+=px*wt;by+=py*wt;score+=wt;if(px<minx)minx=px;if(px>maxx)maxx=px;if(py<miny)miny=py;if(py>maxy)maxy=py;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=xg+ox,ny=yg+oy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(mask[ni]&&!seen[ni]){seen[ni]=1;qx.push(nx);qy.push(ny);}}}if(area>=settings.minBlob&&score>0){const mx=bx/score,my=by/score,dist=Math.hypot(mx-cx,my-cy),boxArea=Math.max(1,(maxx-minx+scale)*(maxy-miny+scale)),fill=area*scale*scale/boxArea;comps.push({x:mx,y:my,area,score,dist,fill,minx,maxx,miny,maxy});}}}
ctx.strokeStyle="rgba(250,204,21,.95)";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();ctx.strokeStyle="rgba(56,189,248,.8)";ctx.beginPath();ctx.arc(cx,cy,6,0,Math.PI*2);ctx.stroke();if(inner>2){ctx.strokeStyle="rgba(255,255,255,.35)";ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);ctx.stroke();}
if(comps.length===0){lastFeature={phase:null,confidence:0,area:0,candidateCount:0,center:{x:cx,y:cy,r:radius}};return null;}let best=null,bestVal=-1;for(const c of comps){const radial=c.dist/radius;if(radial<.42)continue;let continuity=1;if(lastRawAngle!==null){const a=Math.atan2(c.y-cy,c.x-cx);const diff=Math.abs(normalize(a-lastRawAngle));continuity=Math.max(.25,1.6-diff);}const val=c.score*Math.pow(radial,1.8)*continuity*(.5+c.fill);if(val>bestVal){bestVal=val;best=c;}}
if(!best){lastFeature={phase:null,confidence:0,area:0,candidateCount:comps.length,center:{x:cx,y:cy,r:radius}};return null;}ctx.strokeStyle="#22c55e";ctx.lineWidth=3;ctx.strokeRect(best.minx,best.miny,best.maxx-best.minx+scale,best.maxy-best.miny+scale);ctx.beginPath();ctx.arc(best.x,best.y,12,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(best.x,best.y);ctx.stroke();const radial=best.dist/radius;const areaScore=Math.min(1,best.area/20);const radialScore=Math.max(0,Math.min(1,(radial-.42)/.45));confidence=Math.round(100*Math.min(1,areaScore*.45+radialScore*.35+best.fill*.20));lastFeature={phase:Math.atan2(best.y-cy,best.x-cx),confidence,area:best.area,candidateCount:comps.length,bestScore:bestVal,radial:radial,fill:best.fill,center:{x:cx,y:cy,r:radius},blob:best};return lastFeature.phase;}
function updateAngle(angle,now){
 lastAccepted=false;lastRejectReason="-";lastCalcRpm=0;
 if(lastRawAngle===null){lastRawAngle=angle;unwrappedAngle=0;lastUnwrapDeg=0;angleHist=[{t:now,a:0}];lastRejectReason="first";return;}
 const d=normalize(angle-lastRawAngle);lastDeltaRad=d;lastDeltaDeg=d*180/Math.PI;
 if(!(Math.abs(d)>0.008)){lastRejectReason="small_delta";lastRawAngle=angle;return;}
 if(!(Math.abs(d)<3.12)){lastRejectReason="delta_over_179deg";lastRawAngle=angle;return;}
 unwrappedAngle+=d;lastUnwrapDeg=unwrappedAngle*180/Math.PI;
 angleHist.push({t:now,a:unwrappedAngle});
 const cutoff=now-settings.fitWindow;angleHist=angleHist.filter(p=>p.t>=cutoff);
 if(angleHist.length<4){lastRejectReason="few_points";lastRawAngle=angle;return;}
 const n=angleHist.length,mt=angleHist.reduce((sum,p)=>sum+p.t,0)/n,ma=angleHist.reduce((sum,p)=>sum+p.a,0)/n;
 let num=0,den=0;for(const p of angleHist){num+=(p.t-mt)*(p.a-ma);den+=(p.t-mt)*(p.t-mt);}
 if(den<=0){lastRejectReason="den0";lastRawAngle=angle;return;}
 const calc=Math.abs((num/den)*60000/(Math.PI*2));lastCalcRpm=calc;
 if(calc>=settings.maxValid){lastRejectReason="over_maxValid";lastRawAngle=angle;return;}
 const jumpOk=rpm===0||Math.abs(calc-rpm)<Math.max(420,rpm*1.10);
 if(!jumpOk){lastRejectReason="jump_reject";lastRawAngle=angle;return;}
 rpm=rpm*.42+calc*.58;if(rpm>maxRpm)maxRpm=rpm;lastAccepted=true;lastRejectReason="accepted";lastRawAngle=angle;
}
function maybeSnapshot(now){
 if(!measuring||!lastFeature||rpm<settings.snapshotRpm||snapshots.length>=12)return;
 if(now-lastSnapshotAt<450)return;
 try{snapshots.push({time:now.toFixed(1),rpm:Math.round(rpm),calcRpm:Math.round(lastCalcRpm),deltaDeg:lastDeltaDeg.toFixed(1),confidence,reason:lastRejectReason,img:overlay.toDataURL("image/jpeg",0.72)});lastSnapshotAt=now;}catch(e){}
}
function loop(now){
 resize();
 frameTimes.push(now);frameTimes=frameTimes.filter(t=>now-t<1000);
 measuredFps=frameTimes.length>1?(frameTimes.length-1)*1000/(frameTimes[frameTimes.length-1]-frameTimes[0]):0;
 reliableMaxRpm=Math.floor(measuredFps*30);$("fpsNow").textContent=measuredFps?measuredFps.toFixed(1):"0";$("reliableMax").textContent=reliableMaxRpm||0;
 const w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);let angle=null;let prevTime=frameTimes.length>1?frameTimes[frameTimes.length-2]:null;let deltaMs=prevTime===null?"":(now-prevTime);
 if(video.readyState>=2){ctx.drawImage(video,0,0,w,h);angle=detectBlackWeight(w,h);if(angle!==null&&measuring)updateAngle(angle,now);else if(measuring){lastRejectReason="no_angle";lastCalcRpm=0;}}
 if(measuring){
  frameIndex++;stableMaxRpm=Math.max(stableMaxRpm,rpm);samples.push({t:now,rpm:Math.round(rpm),conf:confidence});samples=samples.filter(s=>now-s.t<=10000);maybeSnapshot(now);
  const f=lastFeature||{};const b=f.blob||{};const c=f.center||{};
  logs.push({frameIndex,timestamp:now.toFixed(3),deltaMs:deltaMs===""?"":deltaMs.toFixed(3),rpm:Math.round(rpm),calcRpm:lastCalcRpm?lastCalcRpm.toFixed(1):"",maxRpm:Math.round(maxRpm),fps:measuredFps.toFixed(2),phaseDeg:angle===null?"":(angle*180/Math.PI).toFixed(2),unwrapDeg:lastUnwrapDeg.toFixed(2),deltaDeg:lastDeltaDeg.toFixed(2),accepted:lastAccepted?1:0,rejectReason:lastRejectReason,confidence,blobArea:f.area||0,blobCandidates:f.candidateCount||0,blobScore:f.bestScore?Math.round(f.bestScore):"",blobRadial:f.radial?f.radial.toFixed(3):"",blobX:b.x?b.x.toFixed(1):"",blobY:b.y?b.y.toFixed(1):"",centerX:c.x?c.x.toFixed(1):"",centerY:c.y?c.y.toFixed(1):"",centerR:c.r?c.r.toFixed(1):""});
  if(logs.length>12000)logs.shift();drawChart();
 }
 $("rpm").textContent=Math.round(rpm);$("maxRpm").textContent=Math.round(maxRpm);$("confidence").textContent=confidence||0;$("confFill").style.width=(confidence||0)+"%";$("blobArea").textContent=lastFeature?lastFeature.area:0;$("angleDeg").textContent=angle===null?"--":Math.round(angle*180/Math.PI);$("frameCount").textContent=frameIndex;$("deltaDeg").textContent=lastDeltaDeg.toFixed(0);$("calcRpm").textContent=lastCalcRpm?Math.round(lastCalcRpm):0;$("rejectReason").textContent=lastRejectReason;$("snapshotCount").textContent=snapshots.length;
 $("rpmCard").className="card "+(rpm>=900?"good":rpm>=650?"warn":"");
 if(frameIndex%10===0){$("debug").textContent=`phase=${currentPhase}\nrpm=${Math.round(rpm)} calc=${Math.round(lastCalcRpm)} max=${Math.round(maxRpm)} fps=${measuredFps.toFixed(1)} reliableMax=${reliableMaxRpm}\ndelta=${lastDeltaDeg.toFixed(1)}deg unwrap=${lastUnwrapDeg.toFixed(1)}deg reason=${lastRejectReason}\nconfidence=${confidence}% area=${lastFeature?lastFeature.area:0} candidates=${lastFeature?lastFeature.candidateCount:0} snapshots=${snapshots.length}\nlog rows=${logs.length}`;}
 requestAnimationFrame(loop);
}
function drawChart(){const w=chart.width,h=chart.height,p=28*devicePixelRatio;cctx.clearRect(0,0,w,h);cctx.fillStyle="#111827";cctx.fillRect(0,0,w,h);const maxY=Math.max(300,1000,...samples.map(s=>s.rpm),maxRpm)*1.08,now=performance.now();cctx.strokeStyle="rgba(255,255,255,.16)";cctx.lineWidth=1*devicePixelRatio;for(let i=0;i<=4;i++){const y=p+(h-p*2)*i/4;cctx.beginPath();cctx.moveTo(p,y);cctx.lineTo(w-p,y);cctx.stroke();}cctx.strokeStyle="#facc15";cctx.lineWidth=3*devicePixelRatio;cctx.beginPath();let started=false;for(const s of samples){const x=p+(w-p*2)*(1-(now-s.t)/10000),y=h-p-(h-p*2)*(s.rpm/maxY);if(!started){cctx.moveTo(x,y);started=true;}else cctx.lineTo(x,y);}cctx.stroke();cctx.strokeStyle="rgba(34,197,94,.65)";cctx.setLineDash([5*devicePixelRatio,4*devicePixelRatio]);const y1000=h-p-(h-p*2)*(1000/maxY);cctx.beginPath();cctx.moveTo(p,y1000);cctx.lineTo(w-p,y1000);cctx.stroke();cctx.setLineDash([]);cctx.fillStyle="rgba(255,255,255,.75)";cctx.font=`${12*devicePixelRatio}px system-ui`;cctx.fillText("10秒",p,h-8*devicePixelRatio);cctx.fillText("現在",w-p-36*devicePixelRatio,h-8*devicePixelRatio);cctx.fillText("1000rpm",p+4*devicePixelRatio,y1000-4*devicePixelRatio);}
function download(name,text,type="text/plain"){const blob=new Blob([text],{type});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);} 
$("downloadFrameBtn").onclick=()=>{const cols=["frameIndex","timestamp","deltaMs","rpm","calcRpm","maxRpm","fps","phaseDeg","unwrapDeg","deltaDeg","accepted","rejectReason","confidence","blobArea","blobCandidates","blobScore","blobRadial","blobX","blobY","centerX","centerY","centerR"];const csv=[cols.join(","),...logs.map(r=>cols.map(c=>String(r[c]??"").replaceAll(",",";" )).join(","))].join("\n");download("ono_spin_analyzer_v0_2_log.csv",csv,"text/csv");};

$("downloadSnapshotBtn").onclick=()=>{
 const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>ONO Spin Analyzer snapshots</title><style>body{font-family:system-ui;background:#07111f;color:#f8fafc} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px} .card{background:#111827;border:1px solid #334155;border-radius:14px;padding:10px} img{width:100%;border-radius:10px}</style><h1>ONO Spin Analyzer Ver0.2 画像ログ</h1><p>しきい値 ${settings.snapshotRpm} rpm 以上で自動保存。枚数=${snapshots.length}</p><div class="grid">${snapshots.map((s,i)=>`<div class="card"><h3>#${i+1} ${s.rpm} rpm</h3><p>time=${s.time} ms / calc=${s.calcRpm} / Δθ=${s.deltaDeg}° / conf=${s.confidence}% / ${s.reason}</p><img src="${s.img}"></div>`).join("")}</div></html>`;
 download("ono_spin_analyzer_v0_2_snapshots.html",html,"text/html");
};
$("downloadSummaryBtn").onclick=()=>{const summary={app:"ONO Spin Analyzer",version:"0.2",timestamp:new Date().toISOString(),maxRpm:Math.round(maxRpm),fps:measuredFps,settings,logRows:logs.length,snapshots:snapshots.length,note:"Ver0.2 detailed diagnostic log for 667rpm failure analysis. Includes theta/delta/calcRpm/rejection/blob candidates and threshold snapshots."};download("ono_spin_summary.json",JSON.stringify(summary,null,2),"application/json");};
setPhase("IDLE");resize();
