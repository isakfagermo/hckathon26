import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { kjørAgent, lesAgentKonfig } from './agent.js';
import { system, lagVerktøy, standardVed } from './verktoy.js';
import { tilMs } from './tid.js';
import { formaterRapport } from './rapport.js';

const hjelp = `NATTESKIFTET · Første vakt når alarmen går

Bruk: npm start -- [valg] ["alarmtekst"]

  --liste                  Vis de fem alarmene uten API-kall
  --alarm ID|tjeneste       Velg alarm (standard: ALARM-0312)
  --alle                   Undersøk alle tilgjengelige alarmer
  --demo                   Kjør kuratert referanseanalyse uten API-nøkkel
  --ved TID                Avgrens daterte kilder til TID, f.eks. 03:05
  --json                   Skriv maskinlesbar JSON til stdout
  --ut FIL                 Lagre rapport som Markdown (JSON med --json)
  --spor FIL               Lagre verktøykall, resultater og tokenbruk i JSON
  --stille                 Skjul fremdrift på stderr
  --help                   Vis denne hjelpen

Eksempler:
  npm run demo
  npm start -- --alarm api-gateway
  npm start -- --alarm innlogging --ved 03:05
  npm start -- --demo --alarm varsling --ut rapport.md
  npm start -- "ALARM kl 03:40: api-gateway gir 17 % 504"

Standard er retrospektiv analyse ved siste logglinje (${standardVed}).
--demo er en håndskrevet referanse, ikke en gjennomført modellkjøring.
Modellmodus krever ANTHROPIC_API_KEY. Alle verktøy har kun lesetilgang.
`;

export function lesAlternativer(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    liste: { type: 'boolean' }, alarm: { type: 'string' }, alle: { type: 'boolean' },
    demo: { type: 'boolean' }, ved: { type: 'string' }, json: { type: 'boolean' },
    ut: { type: 'string' }, spor: { type: 'string' }, stille: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return { ...values, oppgave: '' };
  if (values.alarm && values.alle) throw new Error('Velg enten --alarm eller --alle.');
  if (positionals.length && (values.alarm || values.alle || values.demo || values.liste)) throw new Error('Fri alarmtekst kan ikke kombineres med --alarm, --alle, --demo eller --liste.');
  if (values.demo && values.ved) throw new Error('--demo bruker siste observasjonstidspunkt. Bruk modellmodus med --ved for en tidligere analyse.');
  if (values.liste && (values.alarm || values.alle || values.demo || values.ut || values.spor)) throw new Error('--liste kan ikke kombineres med analyse- eller eksportvalg.');
  for (const flagg of ['alarm', 'ved', 'ut', 'spor']) if (values[flagg] !== undefined && !values[flagg].trim()) throw new Error(`--${flagg} kan ikke være tom.`);
  if (values.ut && values.spor && path.resolve(values.ut) === path.resolve(values.spor)) throw new Error('--ut og --spor må være forskjellige filer.');
  return { ...values, oppgave: positionals.join(' ') };
}

function visEvent(event) {
  if (event.type === 'runde') console.error(`  Runde ${event.nummer} · ${event.stop_reason}`);
  else if (event.type === 'verktoy') {
    console.error(`  ${event.feil ? '✗' : '→'} ${event.navn} ${JSON.stringify(event.input)}${event.cache ? ' (cache)' : ''}`);
    if (event.feil) console.error(`    ${event.resultat}`);
    else {
      const ider = event.resultat?.kilder ?? [];
      console.error(`    ${ider.length} kilder${ider.length ? ` · ${ider.slice(0, 5).join(', ')}${ider.length > 5 ? ', …' : ''}` : ''}`);
    }
  } else if (event.melding) console.error(`  ${event.melding}`);
}

function skrivNyFil(fil, tekst) {
  // Unngå å overskrive en tidligere rapport ved et uhell.
  fs.writeFileSync(fil, tekst, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

export async function main(argv = process.argv.slice(2)) {
  const valg = lesAlternativer(argv);
  if (valg.help) { console.log(hjelp); return 0; }
  try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const ved = valg.ved ? new Date(tilMs(valg.ved)).toISOString() : standardVed;
  const verktøy = valg.ved ? lagVerktøy({ ved }) : lagVerktøy();
  const alarmSvar = await verktøy.find(v => v.definisjon.name === 'hent_alarmer').kjør({});
  const alarmer = alarmSvar.alarmer;
  if (valg.liste) {
    console.log(valg.json ? JSON.stringify(alarmSvar, null, 2) : alarmer.map(a => `${a.id}  ${a.tid.slice(11, 16)}  ${a.alvorlighet.padEnd(9)} ${a.tjeneste.padEnd(12)} ${a.tittel}`).join('\n') || 'Ingen alarmer før observasjonstidspunktet.');
    return 0;
  }
  let valgte;
  if (valg.oppgave) valgte = [{ id: null, tekst: valg.oppgave }];
  else if (valg.alle) valgte = alarmer;
  else {
    const søk = valg.alarm ?? 'ALARM-0312';
    const alarm = alarmer.find(a => a.id === søk || a.tjeneste === søk);
    if (!alarm) throw new Error(`Fant ikke alarm «${søk}» før ${ved}. Bruk --liste for tilgjengelige alarmer.`);
    valgte = [alarm];
  }
  if (!valgte.length) throw new Error('Ingen alarmer å analysere før observasjonstidspunktet.');
  for (const fil of [valg.ut, valg.spor].filter(Boolean)) {
    if (fs.existsSync(fil)) throw new Error(`Filen finnes allerede: ${fil}. Velg et nytt filnavn.`);
    if (!fs.existsSync(path.dirname(path.resolve(fil)))) throw new Error(`Mappen finnes ikke: ${path.dirname(path.resolve(fil))}`);
    if (!fs.statSync(path.dirname(path.resolve(fil))).isDirectory()) throw new Error(`Målmappen er ikke en mappe: ${path.dirname(path.resolve(fil))}`);
  }
  if (!valg.demo && !process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og legg inn nøkkelen, eller kjør npm run demo uten nøkkel.');
  const konfig = valg.demo ? null : lesAgentKonfig();
  const controller = new AbortController();
  const avbryt = () => controller.abort();
  process.once('SIGINT', avbryt);
  const resultater = [];
  try {
    for (const alarm of valgte) {
      if (controller.signal.aborted) break;
      if (!valg.stille) console.error(`\n🎃 ${alarm.id ?? 'Egen alarm'} · ${valg.demo ? 'KURATERT REFERANSEDEMO – ingen modell' : 'MODELLANALYSE'}\n   Datagrunnlag t.o.m. ${ved}`);
      const onEvent = valg.stille ? () => {} : visEvent;
      const resultat = valg.demo
        ? await (await import('./demo.js')).kjørDemo({ alarmId: alarm.id, verktøy, ved, onEvent })
        : await kjørAgent({ system, oppgave: alarm.id ? `${alarm.id} (${alarm.tid}): ${alarm.tekst}` : alarm.tekst, verktøy, ved, konfig, signal: controller.signal, onEvent });
      resultater.push({ ...resultat, alarmId: alarm.id });
    }
  } finally { process.removeListener('SIGINT', avbryt); }
  const rapportTekst = resultater.map(r => r.rapport
    ? formaterRapport(r.rapport, { ved: r.ved, modus: r.modus, kilder: new Map(r.kilder.map(k => [k.kilde_id, k])) })
    : `# Ufullstendig analyse\n\n${r.årsak}\n\nObservasjonstidspunkt: ${r.ved}. ${r.kilder.length} kilder hentet. Ingen ferdig situasjonsrapport.\n`).join('\n---\n\n');
  const json = JSON.stringify({ observasjonstidspunkt: ved, resultater }, null, 2) + '\n';
  const tekst = valg.json ? json : rapportTekst;
  console.log(tekst);
  if (valg.ut) skrivNyFil(valg.ut, tekst);
  if (valg.spor) skrivNyFil(valg.spor, json);
  if (!valg.stille) for (const r of resultater) console.error(`\n${r.status} · ${r.iterasjoner} modellrunder · ${r.verktoykall} lesekall · ${Object.values(r.bruk).reduce((a, b) => a + b, 0)} registrerte tokens`);
  return controller.signal.aborted ? 130 : resultater.some(r => r.status !== 'ok') ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().then(kode => { process.exitCode = kode; }).catch(e => {
    console.error(`Feil: ${e.message}`);
    process.exitCode = 1;
  });
}
