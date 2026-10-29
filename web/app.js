const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const names = {betaling:'Betaling',innlogging:'Innlogging',sok:'Søk',varsling:'Varsling','api-gateway':'API-gateway','kunde-db':'Kunde-db'};
const icons = {betaling:'◈',innlogging:'⚿',sok:'⌕',varsling:'✉','api-gateway':'⇄','kunde-db':'▤'};
const toolNames = {hent_alarmer:'Leser alarmen',hent_tjenesteinfo:'Kartlegger tjenester og eiere',sok_i_logger:'Søker i logger',sjekk_deploy_historikk:'Undersøker endringshistorikk',hent_runbook:'Leser runbook',finn_lignende_hendelser:'Sammenligner tidligere hendelser',hent_ovelsesmaalinger:'Henter nye øvelsesmålinger'};
const maps = {'api-gateway':['api-gateway','innlogging','kunde-db'],betaling:['betaling','kunde-db'],innlogging:['innlogging','kunde-db'],sok:['api-gateway','sok'],varsling:['innlogging','varsling']};
const known = {'ALARM-0340':'Opptaket sier at betalingsfeilen startet 03:25. Det er første treff i et filtrert søk; faktisk første TypeError er 02:52:30. Hovedsporet om databasevedlikehold er støttet.', 'ALARM-0331':'30-minuttersgrensen nås først etter ca. 03:52:15, dersom feilen vedvarer. Datagrensen her er 03:48:05. Påstanden om fungerende push mangler belegg.', 'ALARM-0305':'Diskmålingen på 54 % gjelder kl. 03:09:12, ikke en ny måling ved datagrensen.', 'ALARM-0320':'Heap under 86 % er et foreslått kontrollnivå i opptaket, ikke en dokumentert friskmeldingsgrense.'};
let setup, selected='ALARM-0340', running=false, current=null, controller=null, generation=0, started=0, ticker, callCount=0, tokenCount=0, lastAction=null, scareShown=false, audio;
const sources = new Map();
const initialReport=$('report').innerHTML;
function announce(s){$('announce').textContent=s;}
function renderMap(){
  const a=setup.alarmer.find(a=>a.id===selected); const map=$('serviceMap');map.replaceChildren();
  for(const [i,name] of maps[a.tjeneste].entries()){
    if(i) map.append(el('span','→','connection'));
    const node=el('div',undefined,'service-node'+(name===a.tjeneste?' selected':''));node.dataset.service=name;
    node.append(el('span',icons[name]),el('b',names[name]),el('small',name===a.tjeneste?'Valgt alarm':'Avhengighet'));
    map.append(node);
  }
}
function renderAlarms(){
  $('alarms').replaceChildren();
  for(const a of setup.alarmer){
    const b=el('button',undefined,'alarm'+(a.id===selected?' selected':'')+(a.alvorlighet==='advarsel'?' warning':'')); b.setAttribute('aria-pressed',a.id===selected);
    const top=el('div',undefined,'alarm-top');top.append(el('span',a.id),el('span',a.tid.slice(11,16))); const title=el('b');title.append(el('i',undefined,'alarm-dot'),document.createTextNode(names[a.tjeneste]));
    b.append(top,title,el('p',a.tittel));b.onclick=()=>selectAlarm(a.id);$('alarms').append(b);
  }
}
function reset(){
  current=null;lastAction=null;sources.clear();callCount=0;tokenCount=0;$('rounds').textContent='—';$('calls').textContent='—';$('tokens').textContent='—';$('elapsed').textContent='00:00';
  $('events').replaceChildren();$('report').innerHTML=initialReport;$('export').hidden=true;$('exercise').hidden=true;$('simulation').replaceChildren();$('reviewSimulation').hidden=true;
  $('runstatus').textContent='KLAR';$('runstatus').className='badge';
}
function selectAlarm(id){
  if(running) stopRun(); selected=id;reset();renderAlarms();renderMap();
  const a=setup.alarmer.find(a=>a.id===id);$('incidentTitle').textContent=a.tittel;$('incidentText').textContent=a.tekst;$('severity').textContent=a.alvorlighet.toUpperCase();$('severity').className='badge '+(a.alvorlighet==='kritisk'?'critical':'amber');
  addEvent('☾','Klar for '+names[a.tjeneste],'Start undersøkelsen for å følge innhentingen av belegg.');
}
function setRunning(value){running=value;$('start').disabled=value;$('mode').disabled=value;$('stop').hidden=!value;$('reviewSimulation').disabled=value;document.querySelectorAll('[data-action]').forEach(b=>b.disabled=value);if(!value)clearInterval(ticker);}
function stopRun(){controller?.abort();generation++;setRunning(false);$('runstatus').textContent='AVBRUTT';addEvent('■','Kjøringen er stoppet','En allerede sendt API-forespørsel kan ha brukt tokens.');announce('Kjøringen er stoppet.');}
function addEvent(icon,title,description,detail){
  const li=el('li');li.append(el('span',icon,'event-icon'));const content=el('div');content.append(el('b',title),el('p',description));
  if(detail){const d=el('details');d.append(el('summary','Åpne verktøyspor'),el('pre',JSON.stringify(detail,null,2)));content.append(d);}
  li.append(content);$('events').append(li);$('events').scrollTop=$('events').scrollHeight;
}
function collect(v){if(!v||typeof v!=='object')return;if(v.kilde_id)sources.set(v.kilde_id,v);for(const child of Object.values(v))collect(child);}
function checkHaunting(){
  const r=sources.get('RUNBOOK-kunde-db'), catalog=sources.get('TJENESTE-kunde-db');
  if(r&&catalog&&!document.getElementById('haunting')){
    const removed=JSON.stringify(catalog).toLowerCase();
    if(removed.includes('pgbouncer')&&removed.includes('fjernet')){
      addEvent('👻','En runbook fra graven','Runbooken antar pgbouncer. Tjenestekatalogen sier at komponenten er fjernet. Kryssjekk før tiltak.');
      $('events').lastChild.id='haunting';
      if($('scary').checked&&!scareShown){scareShown=true;showScare();}
    }
  }
}
function consume(e){
  if(e.type==='runde'){$('rounds').textContent=e.nummer;tokenCount+=Object.entries(e.bruk).filter(([k])=>['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].includes(k)).reduce((s,[,v])=>s+v,0);$('tokens').textContent=tokenCount.toLocaleString('nb-NO');addEvent('↻','Modellrunde '+e.nummer,`${e.stop_reason} · registrert tokenbruk oppdatert`);}
  if(e.type==='verktoy'){
    callCount++;$('calls').textContent=callCount;collect(e.resultat);
    addEvent(e.feil?'!':'↗',toolNames[e.navn]??e.navn,`${JSON.stringify(e.input)} · ${e.feil?'Avvist':(e.resultat?.kilder?.length??0)+' kilde-ID-er'}${e.cache?' · cache':''}`,e);
    document.querySelectorAll('[data-service]').forEach(n=>{if(sources.has('TJENESTE-'+n.dataset.service))n.classList.add('observed');});checkHaunting();
  }
  if(e.type==='kontroll'){addEvent('⚖','Kontrollrunde: utfordrer utkastet',e.melding,e.grunnlag);$('runstatus').textContent='KONTROLLERER';announce('Agenten kontrollerer rapportutkastet.');}
  if(e.type==='valideringsfeil'||e.type==='feil'||e.type==='budsjett')addEvent('!',e.type==='valideringsfeil'?'Rapport må repareres':'Melding fra agenten',e.melding);
  if(e.type==='ferdig')finish(e.resultat);
}
function cite(ids){const box=el('span');for(const id of ids){const b=el('button',id,'source-chip');b.onclick=()=>openSource(id);box.append(b);}return box;}
function openSource(id){$('sourceTitle').textContent=id;$('sourceContent').textContent=JSON.stringify(sources.get(id)??{melding:'Kilden er ikke tilgjengelig.'},null,2);$('sourceDialog').showModal();}
function renderReport(r){
  const box=el('div',undefined,'report-content');box.append(el('div',r.modus,'notice'));
  if(!r.rapport){box.append(el('h3','Ufullstendig analyse'),el('p',r.årsak??'Ingen ferdig rapport.'));$('report').replaceChildren(box);return;}
  const report=r.rapport;box.append(el('h3',report.tittel),el('span',report.status.toUpperCase(),'badge '+(report.status==='avklart'?'success':'amber')));
  if(r.modus.startsWith('Lagret')){const n=el('div',undefined,'notice');n.append(el('strong','Opptak før ny kontrollrunde'),el('span',known[selected]??'Originalt modellsvar. Kontroller fortsatt påstandene mot kildene.'));box.append(n);}
  box.append(el('h4','Sannsynlig forklaring'));
  for(const h of report.hypoteser){const p=el('p',h.tekst);p.append(document.createTextNode(' '),cite(h.kilder));box.append(p,el('span',h.sikkerhet+' sikkerhet','badge'));if(h.motbevis.length){const d=el('details');d.append(el('summary','Motbevis og begrensninger'));const ul=el('ul');h.motbevis.forEach(x=>ul.append(el('li',x)));d.append(ul);box.append(d);}}
  box.append(el('h4','Neste steg · menneskelig beslutning'));
  for(const [i,s] of report.neste_steg.entries()){box.append(el('p',`${i+1}. ${s.tiltak}`),el('p','Ansvarlig: '+s.ansvarlig),el('p','Kontroll: '+s.verifisering),cite(s.kilder));}
  const facts=el('details');facts.append(el('summary',`Observerte fakta (${report.fakta.length})`));for(const f of report.fakta){const p=el('p',f.tekst);p.append(cite(f.kilder));facts.append(p);}box.append(facts);
  const uncertainty=el('details');uncertainty.append(el('summary','Det vi ikke vet'));report.usikkerhet.forEach(x=>uncertainty.append(el('p',x)));box.append(uncertainty);
  box.append(el('h4','Eskalering'),el('p',report.eskalering),el('p','Datagrense: '+r.ved+' · Kilde-ID-er er kontrollert. Det er ingen garanti for semantisk riktighet.','muted small'));
  $('report').replaceChildren(box);
}
function finish(r){
  current=r;collect(r.kilder);renderReport(r);$('export').hidden=false;$('exercise').hidden=selected!=='ALARM-0340'||r.status!=='ok';$('runstatus').textContent=r.status==='ok'?'RAPPORT KLAR':'UFULLSTENDIG';$('runstatus').className='badge '+(r.status==='ok'?'success':'amber');
  $('rounds').textContent=r.iterasjoner;$('calls').textContent=r.verktoykall;$('tokens').textContent=Object.values(r.bruk).reduce((a,b)=>a+b,0).toLocaleString('nb-NO');
  addEvent(r.status==='ok'?'✓':'!','Undersøkelsen er avsluttet',r.status==='ok'?'Rapport og kilder er tilgjengelige i panelet.':r.årsak);announce('Undersøkelsen er avsluttet. '+(r.rapport?'Rapporten er klar.':r.årsak));
}
async function startRun(tiltak){
  if(running)return;
  const mode=tiltak?'live':$('mode').value;
  if(mode==='live'&&!$('apiKey').value.trim()&&!setup.harNøkkel){$('keyarea').hidden=false;$('apiKey').focus();announce('Legg inn API-nøkkel først.');return;}
  if(!tiltak){reset();renderMap();}else{$('events').replaceChildren();callCount=0;tokenCount=0;}
  const run=++generation;controller=new AbortController();setRunning(true);started=Date.now();$('runstatus').textContent=mode==='live'?'UNDERSØKER':'SPILLER AV';$('runstatus').className='badge amber';$('timeLabel').textContent=mode==='live'?'KJØRETID':'AVSPILLINGSTID';
  ticker=setInterval(()=>{const s=Math.floor((Date.now()-started)/1000);$('elapsed').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;},250);
  addEvent(mode==='live'?'●':'↻',mode==='live'?'Agenten er på vakt':'Spiller av lagret API-kjøring',mode==='live'?'Ekte modellkall med leseverktøy og obligatorisk kontrollrunde.':'Opptak fra 29. oktober. Nye funksjoner og kontrollrunde var ikke med i denne kjøringen.');
  try{
    const response=await fetch('/api/analyse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alarmId:selected,modus:mode,apiKey:mode==='live'?$('apiKey').value:undefined,tiltak}),signal:controller.signal});
    if(!response.ok){const e=await response.json();throw new Error(e.feil);}
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',complete=false;
    while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let nl;while((nl=pending.indexOf('\n'))>=0){const line=pending.slice(0,nl);pending=pending.slice(nl+1);if(line&&run===generation){const e=JSON.parse(line);consume(e);if(e.type==='ferdig')complete=true;}}}
    if(!complete&&run===generation)throw new Error('Strømmen sluttet uten ferdig rapport. Prøv igjen.');
  }catch(e){if(e.name!=='AbortError'&&run===generation){addEvent('!','Undersøkelsen stoppet',e.message);$('runstatus').textContent='FEIL';announce(e.message);}}
  finally{if(run===generation)setRunning(false);}
}
function modeChanged(){const live=$('mode').value==='live';$('keyarea').hidden=!live;$('modehint').textContent=live?'Nye modellkall mot Anthropic. Bruker API-kvote. Dataene er fiktive.':'Ekte modellkjøring fra 29.10. Spilles av uten nye API-kall.';$('timeLabel').textContent=live?'KJØRETID':'AVSPILLINGSTID';}
let pendingAction;
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>{pendingAction=b.dataset.action;$('confirmTitle').textContent=b.querySelector('b').textContent;$('confirmText').textContent='Dette godkjenner bare et syntetisk øvelsestiltak. Ingen kommandoer kjøres mot produksjon. Etterpå kontrollerer vi nye målinger.';$('confirmDialog').showModal();};
$('approve').onclick=async()=>{
  $('confirmDialog').close();const requested=pendingAction;const selectedAt=selected;
  try{const r=await fetch('/api/ovelse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tiltak:requested,godkjent:true})});const data=await r.json();if(!r.ok)throw new Error(data.feil);if(selected!==selectedAt)return;
    lastAction=requested;const container=$('simulation');container.replaceChildren(el('div','SYNTETISKE MÅLINGER · '+(requested==='restart_gateway'?'Gateway restartet':'Vedlikehold avbrutt'),'notice'));
    const grid=el('div',undefined,'sim-grid');for(const m of data.målinger){sources.set(m.kilde_id,m);const c=el('div',undefined,'sim-sample');c.append(el('span',m.tid.slice(11,19)),el('b',m.gateway_504_prosent+' %'),el('span','504 / 5 minutter'),el('p',m.aktive_tilkoblinger+' tilkoblinger'),el('p',m.lasventere+' låsventere'),cite([m.kilde_id]));grid.append(c);}container.append(grid);
    const checks=el('div',undefined,'checks'+(data.vurdering.avklart?'':' failed'));for(const k of data.vurdering.kriterier)checks.append(el('div',(k.ok?'✓ ':'× ')+k.navn));container.append(checks,el('p',data.vurdering.melding),el('p','Regelbasert kontroll · ingen modell kjørt','small muted'));
    addEvent('🧪','Simulert tiltak kontrollert',data.vurdering.melding,data);$('reviewSimulation').hidden=false;
  }catch(e){announce(e.message);$('simulation').replaceChildren(el('div',e.message,'notice'));}
};
$('reviewSimulation').onclick=()=>{$('mode').value='live';modeChanged();startRun(lastAction);};
function initAudio(){if($('sound').checked){audio??=new AudioContext();audio.resume();}}
function showScare(){
  if(!$('scary').checked)return;
  $('scareDialog').showModal();
  if($('sound').checked&&audio){const osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';osc.frequency.setValueAtTime(190,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(65,audio.currentTime+.5);gain.gain.setValueAtTime(.07,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.6);osc.connect(gain).connect(audio.destination);osc.start();osc.stop(audio.currentTime+.65);}
  setTimeout(()=>{if($('scareDialog').open)$('scareDialog').close();},2000);
}
$('sound').onchange=initAudio;$('testScare').onclick=()=>{if(!$('scary').checked){$('scary').checked=true;}initAudio();showScare();};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('start').onclick=()=>{initAudio();startRun();};$('stop').onclick=stopRun;$('mode').onchange=modeChanged;
$('export').onclick=()=>{if(!current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`natteskiftet-${selected}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
try{const r=await fetch('/api/oppsett');if(!r.ok)throw new Error('Oppsett kunne ikke lastes.');setup=await r.json();if(setup.harNøkkel){$('apiKey').placeholder='Serveren har en nøkkel · valgfri overstyring';$('keyhint').textContent='Nøkkel er konfigurert på serveren. Hver direkte analyse bruker API-kvote.';}selectAlarm(selected);}catch(e){$('start').disabled=true;$('modehint').textContent=e.message;}
