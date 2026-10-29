// Deterministisk evaluering av kuraterte referanser og deres kildegrunnlag.
// Ingen modell eller ekstern API kjøres. Disse testene måler ikke LLM-kvalitet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scenarier, kjørDemo } from '../src/demo.js';
import { samleKilder } from '../src/agent.js';
import { lagVerktøy, standardVed } from '../src/verktoy.js';
import { validerRapport, formaterRapport } from '../src/rapport.js';

const lesData = (fil) => JSON.parse(fs.readFileSync(new URL(`../data/${fil}`, import.meta.url), 'utf8'));
const originaleLogger = lesData('logger.json');
const originaleDeployer = lesData('deploy-historikk.json');
const originaleAlarmer = lesData('alarmer.json');
const scenarioFor = (id) => {
  const scenario = scenarier.find((rad) => rad.alarmId === id);
  assert.ok(scenario, `Referansescenario ${id} mangler`);
  return scenario;
};

// Ta med også eiere, motbevis og pedagogiske eksempler på fremtidige kilder.
// requiredEvidence er et kjerneutvalg, ikke den komplette referanselisten.
function referanser(verdi, resultat = new Set()) {
  if (!verdi || typeof verdi !== 'object') return resultat;
  for (const [felt, innhold] of Object.entries(verdi)) {
    if (['evidence', 'requiredEvidence', 'excludedLaterEvidence'].includes(felt)) {
      for (const id of innhold) resultat.add(id);
    } else {
      referanser(innhold, resultat);
    }
  }
  return resultat;
}

const alleReferanser = referanser(scenarier);
const runbooks = [...alleReferanser].filter((id) => id.startsWith('RUNBOOK-'));
const kildeCache = new Map();

function hentKilder(ved) {
  if (!kildeCache.has(ved)) {
    kildeCache.set(ved, (async () => {
      const verktøy = lagVerktøy({ ved });
      const etterNavn = new Map(verktøy.map((v) => [v.definisjon.name, v.kjør]));
      const kilder = new Map();
      for (const navn of ['hent_alarmer', 'hent_tjenesteinfo', 'sjekk_deploy_historikk', 'finn_lignende_hendelser']) {
        samleKilder(await etterNavn.get(navn)({}), kilder);
      }
      for (const id of runbooks) {
        samleKilder(await etterNavn.get('hent_runbook')({ tjeneste: id.slice('RUNBOOK-'.length) }), kilder);
      }
      let offset = 0;
      do {
        const svar = await etterNavn.get('sok_i_logger')({ maks: 200, offset });
        samleKilder(svar, kilder);
        const neste = svar.metadata.neste_offset;
        assert.ok(neste === null || neste > offset, 'Paginering må gjøre fremdrift');
        offset = neste;
      } while (offset !== null);
      return kilder;
    })());
  }
  return kildeCache.get(ved);
}

const faktatekst = (scenario) => scenario.facts.map((f) => f.text).join('\n');
const usikkerhet = (scenario) => scenario.uncertainty.join('\n');
const tiltakstekst = (scenario) => scenario.actions.map((a) => a.recommendation).join('\n');

test('kuratert evaluering dekker fem ekte alarmer ved siste faktiske loggtid', () => {
  assert.equal(scenarier.length, 5);
  assert.deepEqual(scenarier.map((s) => s.alarmId).sort(), originaleAlarmer.map((a) => a.id).sort());
  assert.equal(originaleLogger.length, 256);
  assert.equal(standardVed, '2026-10-29T03:48:05+01:00');
  for (const scenario of scenarier) {
    assert.equal(scenario.curated, true);
    assert.equal(scenario.asOf, standardVed);
    assert.equal(scenario.alarmTime, originaleAlarmer.find((a) => a.id === scenario.alarmId).tid);
  }
});

for (const scenario of scenarier) {
  test(`kuratert demo ${scenario.alarmId}: rapporten bruker faktiske verktøykilder og ingen modell`, async () => {
    const hendelser = [];
    const demo = await kjørDemo({
      alarmId: scenario.alarmId,
      ved: scenario.asOf,
      verktøy: lagVerktøy({ ved: scenario.asOf }),
      onEvent: (event) => hendelser.push(event),
    });
    assert.equal(demo.status, 'ok');
    assert.equal(demo.modell, null);
    assert.equal(demo.iterasjoner, 0);
    assert.deepEqual(demo.bruk, { input_tokens: 0, output_tokens: 0 });
    assert.match(demo.modus, /kuratert analyse, ingen modell kjørt/);
    assert.deepEqual(hendelser, demo.spor);
    assert.equal(demo.verktoykall, demo.spor.length);
    assert.ok(demo.spor.every((event) => event.type === 'verktoy' && !event.feil));

    const fraSpor = new Map();
    for (const event of demo.spor) {
      assert.equal(event.resultat.metadata.kun_lesing, true);
      samleKilder(event.resultat, fraSpor);
    }
    const kilder = new Map(demo.kilder.map((kilde) => [kilde.kilde_id, kilde]));
    assert.deepEqual(kilder, fraSpor, 'Demokilder må være hentet i det synlige verktøysporet');
    assert.equal(validerRapport(demo.rapport, { kilder }), demo.rapport);
    assert.equal(demo.rapport.status, scenario.status);
    assert.equal(demo.rapport.alvorlighet, scenario.severity);
    for (const punkt of [...demo.rapport.fakta, ...demo.rapport.hypoteser, ...demo.rapport.neste_steg]) {
      assert.ok(punkt.kilder.length > 0);
      for (const id of punkt.kilder) assert.ok(fraSpor.has(id), `${scenario.alarmId}: ${id} mangler fra verktøysporet`);
    }
    const markdown = formaterRapport(demo.rapport, { ved: demo.ved, modus: demo.modus, kilder });
    assert.match(markdown, /kuratert analyse, ingen modell kjørt/);
    assert.match(markdown, /anbefalinger og er ikke utført av agenten/);
    assert.match(markdown, /2026-10-29T03:48:05\+01:00/);

    // LOG-0254 og flere viktige kilder ligger etter første side på 200 logger.
    const loggsider = demo.spor.filter((event) => event.navn === 'sok_i_logger');
    assert.ok(loggsider.length >= 2, 'Referansedemoen må hente også den siste loggsiden');
    assert.equal(loggsider.at(-1).resultat.metadata.neste_offset, null);
    assert.equal(loggsider.flatMap((event) => event.resultat.logger).length, originaleLogger.length);
  });

  test(`kuratert referanse ${scenario.alarmId}: samtlige ID-er kan slås opp og bevarer originalrad`, async () => {
    const kilder = await hentKilder(scenario.asOf);
    for (const id of referanser(scenario)) {
      const kilde = kilder.get(id);
      assert.ok(kilde, `${scenario.alarmId}: ukjent kilde ${id}`);
      assert.equal(kilde.kilde_id, id);
      assert.ok(kilde.fil, `${id} mangler oppgitt kildefil`);
      const loggnummer = /^LOG-(\d{4})$/.exec(id);
      const deploynummer = /^DEPLOY-(\d{3})$/.exec(id);
      const original = loggnummer ? originaleLogger[Number(loggnummer[1]) - 1]
        : deploynummer ? originaleDeployer[Number(deploynummer[1]) - 1] : null;
      if (loggnummer || deploynummer) {
        assert.ok(original, `${id} peker utenfor originaldata`);
        for (const [felt, verdi] of Object.entries(original)) {
          assert.deepEqual(kilde[felt], verdi, `${id}.${felt} peker ikke på den opprinnelige raden`);
        }
      }
    }
  });

  test(`alarmtid ${scenario.alarmId}: nødvendige kilder er synlige og senere observasjoner er skjult`, async () => {
    const nå = await hentKilder(scenario.asOf);
    const vedAlarm = await hentKilder(scenario.alarmTime);
    const grense = Date.parse(scenario.alarmTime);
    for (const id of scenario.atAlarmTime.requiredEvidence) {
      const kilde = vedAlarm.get(id);
      assert.ok(kilde, `${scenario.alarmId}: nødvendig alarmtidskilde ${id} mangler`);
      if (kilde.tid) assert.ok(Date.parse(kilde.tid) <= grense, `${id} er fra etter alarmen`);
    }
    for (const id of scenario.atAlarmTime.excludedLaterEvidence) {
      const senere = nå.get(id);
      assert.ok(senere, `${id} må være en ekte kilde ved siste loggtid`);
      if (senere.tid) {
        assert.ok(Date.parse(senere.tid) > grense, `${id} er feilaktig merket som fremtidig`);
        assert.equal(vedAlarm.has(id), false, `${id} lekker fremtidig informasjon til alarmtid`);
      }
    }
    for (const kilde of vedAlarm.values()) {
      if (kilde.tid) assert.ok(Date.parse(kilde.tid) <= grense, `${kilde.kilde_id} passerer alarmtidens datagrense`);
    }
  });
}

test('disk: full referanse er avklart, men alarmtid har ingen dokumentert fullføring', async () => {
  const scenario = scenarioFor('ALARM-0305');
  const vedAlarm = await hentKilder(scenario.alarmTime);
  const siste = await hentKilder(scenario.asOf);
  assert.equal(scenario.status, 'avklart');
  assert.match(vedAlarm.get('LOG-0068').melding, /loggrotasjon startet/);
  assert.match(vedAlarm.get('LOG-0082').melding, /91%/);
  assert.equal(vedAlarm.has('LOG-0095'), false);
  assert.match(siste.get('LOG-0095').melding, /loggrotasjon fullført.*54%/);
  assert.match(scenario.atAlarmTime.summary, /fullføring er ennå ikke observert/);
  assert.match(usikkerhet(scenario), /ingen nyere diskprosent/i);
  assert.match(usikkerhet(scenario), /friskmelder ikke innlogging/);
  assert.deepEqual(scenarier.filter((s) => s.status === 'avklart').map((s) => s.alarmId), ['ALARM-0305']);
});

test('søk: alarmens 4,6 s er kjent før detaljloggen, mens nyere enkeltkall ikke beviser friskmelding', async () => {
  const scenario = scenarioFor('ALARM-0320');
  const vedAlarm = await hentKilder(scenario.alarmTime);
  const siste = await hentKilder(scenario.asOf);
  assert.match(vedAlarm.get('ALARM-0320').tekst, /4\.6 s/);
  assert.match(vedAlarm.get('LOG-0123').melding, /4\.1s/);
  assert.equal(vedAlarm.has('LOG-0129'), false);
  assert.equal(vedAlarm.has('LOG-0130'), false);
  const p95Logger = [...siste.values()].filter((k) => k.tjeneste === 'sok' && /p95/.test(k.melding ?? ''));
  const nyeste = p95Logger.sort((a, b) => Date.parse(a.tid) - Date.parse(b.tid)).at(-1);
  assert.equal(nyeste.kilde_id, 'LOG-0141');
  assert.equal(nyeste.tid, '2026-10-29T03:24:16+01:00');
  assert.match(siste.get('LOG-0253').melding, /200 174ms/);
  assert.equal(scenario.status, 'uavklart');
  assert.match(usikkerhet(scenario), /Raske enkeltkall er utilstrekkelige/);
  assert.match(usikkerhet(scenario), /ikke presenteres som en fersk måling/);
  assert.match(tiltakstekst(scenario), /Hvis fullindeksen fortsatt kjører/);
});

test('gateway: referansen forklarer konflikten med gammel pgbouncer-runbook', async () => {
  const scenario = scenarioFor('ALARM-0340');
  const kilder = await hentKilder(scenario.asOf);
  assert.equal(kilder.get('RUNBOOK-kunde-db').sist_oppdatert, '2025-11-04');
  assert.match(kilder.get('RUNBOOK-kunde-db').innhold, /via pgbouncer/);
  assert.match(kilder.get('TJENESTE-kunde-db').beskrivelse, /pgbouncer ble fjernet 12\. mars 2026/);
  assert.match(kilder.get('DEPLOY-003').endring, /torsdag 03:30/);
  assert.match(kilder.get('LOG-0171').melding, /AccessExclusiveLock/);
  assert.match(faktatekst(scenario), /Database-runbooken er fra 2025-11-04/);
  const gammelRunbook = scenario.pitfalls.find((p) => /Restart pgbouncer/.test(p.claim));
  assert.ok(gammelRunbook);
  assert.match(gammelRunbook.assessment, /Runbooken er utdatert/);
  assert.match(gammelRunbook.assessment, /Failover er ikke begrunnet/);
  assert.match(tiltakstekst(scenario), /oppdater kunde-db-runbooken/);
  assert.match(usikkerhet(scenario), /ingen sikkert identifisert PID/);
  assert.match(usikkerhet(scenario), /ikke en trygg prognose/);
});

test('SMS: både ekstern feil og egen retry-forsterkning holdes åpne, uten tidlig 30-minutterseskalering', async () => {
  const scenario = scenarioFor('ALARM-0331');
  const kilder = await hentKilder(scenario.asOf);
  assert.match(kilder.get('LOG-0131').melding, /timeout/);
  assert.match(kilder.get('LOG-0137').melding, /HTTP 429.*retry-after 30s/);
  assert.match(kilder.get('DEPLOY-005').endring, /5 forsøk med kort pause/);
  assert.match(kilder.get('LOG-0196').melding, /sist oppdatert 02:10/);
  assert.notEqual(scenario.hypothesis.confidence, 'høy');
  assert.match(scenario.hypothesis.text, /Rotårsaken er ikke avklart/);
  assert.match(scenario.hypothesis.text, /SmsBud eller forbindelsen/);
  assert.match(scenario.hypothesis.text, /retry-policyen kan forsterke/);
  assert.match(scenario.hypothesis.text, /loggene beviser verken/);
  assert.match(usikkerhet(scenario), /beviser ikke at SmsBud er frisk/);
  const førsteTimeout = Date.parse(kilder.get('LOG-0131').tid);
  assert.equal(Date.parse(scenario.alarmTime) - førsteTimeout, (8 * 60 + 45) * 1000);
  assert.equal(Date.parse(scenario.asOf) - førsteTimeout, (25 * 60 + 50) * 1000);
  assert.ok(Date.parse(scenario.asOf) - førsteTimeout < 30 * 60 * 1000);
  assert.match(scenario.escalation, /terskelen er ikke dokumentert passert/);
  assert.match(tiltakstekst(scenario), /03:52:15, hvis feilen fortsatt pågår/);
});

test('kuratert referanse skiller gamle målinger fra nåtilstand og knytter råd til eier og effektkontroll', () => {
  const betaling = scenarioFor('ALARM-0312');
  assert.match(faktatekst(betaling), /9,4 %.*ikke en ny måling kl 03:48/);
  assert.match(faktatekst(scenarioFor('ALARM-0331')), /nyere kø og rate mangler/);
  assert.match(faktatekst(scenarioFor('ALARM-0340')), /Ingen fullføring eller ny samlet 504-rate/);
  for (const scenario of scenarier) {
    assert.ok(scenario.uncertainty.length > 0);
    for (const råd of scenario.actions) {
      assert.ok(råd.owner.trim(), `${scenario.alarmId}: tiltak mangler ansvarlig`);
      assert.ok(råd.verification.trim(), `${scenario.alarmId}: tiltak mangler kontroll av effekt`);
      assert.ok(råd.evidence.length > 0, `${scenario.alarmId}: tiltak mangler kildegrunnlag`);
    }
  }
});

test('kuratert demo avviser alarmtid og ukjent scenario fremfor å presentere en annen datagrense', async () => {
  const disk = scenarioFor('ALARM-0305');
  await assert.rejects(kjørDemo({
    alarmId: disk.alarmId,
    ved: disk.alarmTime,
    verktøy: lagVerktøy({ ved: disk.alarmTime }),
  }), /bare siste observasjonstidspunkt/);
  await assert.rejects(kjørDemo({
    alarmId: 'ALARM-ukjent',
    ved: standardVed,
    verktøy: lagVerktøy(),
  }), /Ingen referansedemo/);
});
