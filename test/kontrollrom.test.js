import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { lagKontrollgrunnlag } from '../src/kontroll.js';
import { simulerTiltak, vurderEffekt, øvelsesVerktøy } from '../src/ovelse.js';
import { lagServer } from '../src/server.js';

test('tidskontroll beregner SMS-varighet og merker første hentede feil som begrenset', () => {
  const k = { kilde_id: 'LOG-0131', tjeneste: 'varsling', nivå: 'ERROR', tid: '2026-10-29T03:22:15+01:00' };
  const r = lagKontrollgrunnlag({ kilder: new Map([[k.kilde_id,k]]), ved: '2026-10-29T03:48:05+01:00', spor: [{ type:'verktoy', navn:'sok_i_logger', input:{fra:'03:20'}, resultat:{metadata:{avkortet:false}} }] });
  assert.equal(r.tidslinjer[0].sekunder_til_datagrense, 1550);
  assert.equal(r.tidslinjer[0].tretti_minutter_etter, '2026-10-29T02:52:15.000Z');
  assert.match(r.tidslinjer[0].merknad,/ikke nødvendigvis/);
  assert.equal(r.avgrensninger.length,1);
});

test('gatewayrestart løser ikke årsaken, DB-tiltak må bekreftes over målevindu', () => {
  const feil = simulerTiltak('restart_gateway'), riktig=simulerTiltak('avbryt_vedlikehold');
  assert.equal(feil.vurdering.avklart,false);
  assert.equal(riktig.vurdering.avklart,true);
  assert.equal(vurderEffekt(riktig.målinger[1]).avklart,false);
  assert.equal(vurderEffekt({...riktig.målinger[2],malevindu_sekunder:30}).avklart,false);
  assert.throws(()=>simulerTiltak('shell'));
  const tool=øvelsesVerktøy(riktig);
  const copy=tool.kjør({});copy.målinger[2].gateway_504_prosent=99;
  assert.equal(tool.kjør({}).målinger[2].gateway_504_prosent,.8);
  assert.throws(()=>tool.kjør({kommando:'nope'}));
});

test('lokal server isolerer nøkler, avviser fremmed origin og spiller av ekte opptak', async t => {
  const server=lagServer({replayDelay:0});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const setup=await (await fetch(base+'/api/oppsett')).json();assert.equal(setup.alarmer.length,5);assert.equal(typeof setup.harNøkkel,'boolean');assert.equal(setup.apiKey,undefined);
  assert.equal((await post('/api/analyse',{alarmId:'ALARM-0340',modus:'opptak'},{Origin:'https://untrusted.example'})).status,403);
  const hostStatus = await new Promise(resolve => http.get(base+'/', { headers: { Host: 'untrusted.example' } }, r => { r.resume(); resolve(r.statusCode); }));
  assert.equal(hostStatus,403);
  assert.equal((await post('/api/analyse',{alarmId:'../../.env',modus:'opptak'})).status,400);
  assert.equal((await post('/api/ovelse',{tiltak:'restart_gateway'})).status,400);
  const sim=await (await post('/api/ovelse',{tiltak:'restart_gateway',godkjent:true})).json();assert.equal(sim.vurdering.avklart,false);
  const replay=await post('/api/analyse',{alarmId:'ALARM-0340',modus:'opptak'});
  const events=(await replay.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).resultat.status,'ok');assert.match(events.at(-1).resultat.modus,/Lagret/);
  assert.ok(events.some(e=>e.type==='verktoy'&&e.navn==='hent_runbook'));
  assert.equal((await fetch(base+'/src/server.js')).status,404);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
