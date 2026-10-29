import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as vent } from 'node:timers/promises';
import { kjørAgent, lesAgentKonfig } from './agent.js';
import { lagVerktøy, standardVed, system } from './verktoy.js';
import { simulerTiltak, øvelsesVerktøy } from './ovelse.js';

const filer = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const alarmer = JSON.parse(fs.readFileSync(new URL('../data/alarmer.json', import.meta.url)));
const json = (res, kode, data) => { res.writeHead(kode, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
async function lesBody(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 12000) throw new Error('For stor forespørsel.'); }
  return JSON.parse(s);
}

export function lagServer({ klient, konfig = lesAgentKonfig(), replayDelay = 230 } = {}) {
  let liveAktiv = false;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== host && req.headers.host !== `localhost:${req.socket.localPort}`) return json(res, 403, { feil: 'Kun lokal tilgang.' });
    if (req.headers.origin && ![`http://${host}`, `http://localhost:${req.socket.localPort}`].includes(req.headers.origin)) return json(res, 403, { feil: 'Ugyldig origin.' });
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && filer[url.pathname]) {
      const [fil, type] = filer[url.pathname];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      return res.end(fs.readFileSync(new URL(`../web/${fil}`, import.meta.url)));
    }
    if (req.method === 'GET' && url.pathname === '/api/oppsett') return json(res, 200, { alarmer, ved: standardVed, harNøkkel: !!process.env.ANTHROPIC_API_KEY, modell: konfig.modell });
    if (req.method !== 'POST' || !['/api/analyse', '/api/ovelse'].includes(url.pathname)) return json(res, 404, { feil: 'Finnes ikke.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { feil: 'Forventet JSON.' });
    let body;
    try { body = await lesBody(req); } catch { return json(res, 400, { feil: 'Ugyldig forespørsel.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { feil: 'Forventet objekt.' });
    if (url.pathname === '/api/ovelse') {
      if (body.godkjent !== true) return json(res, 400, { feil: 'Tiltaket må godkjennes i øvelsen.' });
      try { return json(res, 200, simulerTiltak(body.tiltak)); } catch { return json(res, 400, { feil: 'Ukjent øvelsestiltak.' }); }
    }
    const alarm = alarmer.find(a => a.id === body.alarmId);
    if (!alarm || !['opptak', 'live'].includes(body.modus)) return json(res, 400, { feil: 'Velg gyldig alarm og modus.' });
    let øvelse;
    if (body.tiltak !== undefined) {
      if (body.modus !== 'live' || alarm.id !== 'ALARM-0340') return json(res, 400, { feil: 'Øvelsesanalyse gjelder gateway i live-modus.' });
      try { øvelse = simulerTiltak(body.tiltak); } catch { return json(res, 400, { feil: 'Ukjent øvelsestiltak.' }); }
    }
    if (body.modus === 'live' && liveAktiv) return json(res, 409, { feil: 'En API-analyse kjører allerede. Stopp eller vent til den er ferdig.' });
    if (body.modus === 'live' && !klient && !(typeof body.apiKey === 'string' && body.apiKey.trim()) && !process.env.ANTHROPIC_API_KEY) return json(res, 400, { feil: 'Legg inn API-nøkkel, eller velg lagret opptak.' });
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    if (body.modus === 'live') liveAktiv = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    const send = event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    try {
      send({ type: 'start', modus: body.modus, alarmId: alarm.id, simulering: !!øvelse });
      if (body.modus === 'opptak') {
        const r = JSON.parse(fs.readFileSync(new URL(`../data/opptak/${alarm.id}.json`, import.meta.url)));
        for (const event of r.spor) { await vent(replayDelay, undefined, { signal: controller.signal }); send(event); }
        send({ type: 'ferdig', resultat: { ...r, modus: 'Lagret API-opptak fra 29.10.2026. Ingen nye modellkall. Før obligatorisk kontrollrunde.' } });
      } else {
        let sdk = klient;
        if (!sdk) {
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          sdk = new Anthropic({ apiKey: body.apiKey?.trim() || process.env.ANTHROPIC_API_KEY, baseURL: 'https://api.anthropic.com', maxRetries: 1, timeout: konfig.timeoutMs });
        }
        delete body.apiKey;
        const verktøy = lagVerktøy();
        if (øvelse) verktøy.push(øvelsesVerktøy(øvelse));
        const resultat = await kjørAgent({ system, klient: sdk, konfig, verktøy, signal: controller.signal, onEvent: send,
          ved: øvelse ? øvelse.målinger.at(-1).tid : standardVed,
          oppgave: `${alarm.id} (${alarm.tid}): ${alarm.tekst}` + (øvelse ? `\nSIMULERINGSØVELSE: Mennesket har valgt ${øvelse.tiltak}. Hent hent_ovelsesmaalinger. Vurder effekten ut fra ALLE tre målingene og femminuttersvinduet. De originale leseverktøyene stopper ved ${standardVed}; nye målinger er syntetiske. Bruk SIM-kilder for alle påstander om effekt. Konkluder kun om øvelsen. Hvis feilen vedvarer: foreslå neste tiltak mot årsaken.` : '') });
        send({ type: 'ferdig', resultat: { ...resultat, alarmId: alarm.id, modus: øvelse ? 'Ekte AI-analyse av syntetisk øvelse' : 'Ekte API-analyse av fiktive oppgavedata' } });
      }
    } catch (e) {
      if (!controller.signal.aborted) send({ type: 'feil', melding: 'Kjøringen feilet. Kontroller nøkkel og tilkobling, eller bruk opptaket.' });
    } finally { if (body.modus === 'live') liveAktiv = false; res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const port = Number(process.env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT må være mellom 1024 og 65535.');
  lagServer().listen(port, '127.0.0.1', () => console.log(`👻 Natteskiftet: http://127.0.0.1:${port}`));
}
