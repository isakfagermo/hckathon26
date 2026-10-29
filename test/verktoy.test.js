import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lagVerktøy, standardVed, verktøy } from '../src/verktoy.js';
import { tilMs, norskDato } from '../src/tid.js';

const dataLogger = JSON.parse(fs.readFileSync(new URL('../data/logger.json', import.meta.url), 'utf8'));
const dataDeployer = JSON.parse(fs.readFileSync(new URL('../data/deploy-historikk.json', import.meta.url), 'utf8'));
function verktøykall(ved) {
  const liste = ved === undefined ? verktøy : lagVerktøy({ ved });
  const etterNavn = new Map(liste.map((v) => [v.definisjon.name, v.kjør]));
  return (navn, input = {}) => etterNavn.get(navn)(input);
}
const kall = verktøykall();

test('alle seks verktøy er aktive og bruker strenge objektskjemaer', () => {
  assert.equal(verktøy.length, 6);
  for (const v of verktøy) {
    assert.equal(typeof v.kjør, 'function');
    assert.equal(v.definisjon.input_schema.additionalProperties, false);
  }
});

test('kort tid tolkes i Oslo; ISO med offset er samme øyeblikk', () => {
  assert.equal(tilMs('3:10:04'), tilMs('2026-10-29T02:10:04Z'));
  assert.equal(tilMs('03:10'), tilMs('2026-10-29T03:10:00+01:00'));
  assert.equal(norskDato(tilMs('2026-10-28T23:30:00Z')), '2026-10-29');
  assert.equal(tilMs('2024-02-29T00:00:00Z'), Date.parse('2024-02-29T00:00:00Z'));
});

test('ugyldige og tvetydige datoer normaliseres aldri i stillhet', () => {
  for (const tid of ['', null, 0, 'i morgen', '24:00', '03:60', '3:10:60',
    '2026-02-29T03:00:00Z', '2026-04-31T00:00:00Z', '2026-10-29',
    '2026-10-29T03:00:00', '2026-10-29T24:00:00Z', '2026-10-29T03:00:00+01:99']) {
    assert.throws(() => tilMs(tid), undefined, String(tid));
  }
});

test('kombinerte loggfiltre, inklusive grenser og stabile kilde-ID-er', async () => {
  const svar = await kall('sok_i_logger', { tjeneste: 'betaling', niva: 'ERROR', tekst: 'TYPEERROR', fra: '02:52:30', til: '02:54:34' });
  assert.equal(svar.logger.length, 2);
  assert.equal(svar.logger[0].tid, '2026-10-29T02:52:30+01:00');
  assert.equal(svar.logger[1].tid, '2026-10-29T02:54:34+01:00');
  assert.equal(svar.logger[0].kilde_id, `LOG-${String(dataLogger.findIndex((r) => r.tid === svar.logger[0].tid && r.tjeneste === 'betaling') + 1).padStart(4, '0')}`);
  assert.deepEqual(svar.kilder, svar.logger.map((r) => r.kilde_id));
  assert.equal(svar.metadata.total, 2);
  assert.equal(svar.metadata.avkortet, false);
});

test('paginering returnerer hver rad nøyaktig én gang og beholder kronologi', async () => {
  const samlet = [];
  let offset = 0;
  do {
    const svar = await kall('sok_i_logger', { maks: 37, offset });
    samlet.push(...svar.logger);
    assert.equal(svar.metadata.total, dataLogger.length);
    assert.equal(svar.metadata.returnert, svar.logger.length);
    assert.equal(svar.metadata.avkortet, svar.metadata.neste_offset !== null);
    offset = svar.metadata.neste_offset;
  } while (offset !== null);
  assert.equal(samlet.length, dataLogger.length);
  assert.equal(new Set(samlet.map((r) => r.kilde_id)).size, dataLogger.length);
  assert.ok(samlet.every((rad, i) => i === 0 || tilMs(rad.tid) >= tilMs(samlet[i - 1].tid)));
  const tom = await kall('sok_i_logger', { offset: 10000 });
  assert.deepEqual(tom.logger, []);
  assert.equal(tom.metadata.neste_offset, null);
});

test('observasjonstid skjuler fremtidige logger, alarmer og utrullinger', async () => {
  const tidlig = verktøykall('03:05');
  const logg = await tidlig('sok_i_logger', { maks: 200, til: '03:48' });
  assert.ok(logg.logger.every((r) => tilMs(r.tid) <= tilMs('03:05')));
  assert.ok(!logg.logger.some((r) => r.melding.includes('loggrotasjon fullført')));
  assert.deepEqual((await tidlig('hent_alarmer')).alarmer.map((r) => r.id), ['ALARM-0305']);
  const førDeploy = await verktøykall('02:51:11')('sjekk_deploy_historikk', { tjeneste: 'betaling' });
  assert.deepEqual(førDeploy.deployer.map((r) => r.versjon), ['2.13.2']);
  assert.equal(logg.metadata.ved, '2026-10-29T02:05:00.000Z');
  assert.equal(logg.metadata.modus, 'avgrenset');
});

test('standard cutoff er siste faktiske datapunkt og er synlig i metadata', async () => {
  const maks = Math.max(...dataLogger.map((rad) => Date.parse(rad.tid)));
  assert.equal(tilMs(standardVed), maks);
  const svar = await kall('hent_alarmer');
  assert.equal(tilMs(svar.metadata.ved), maks);
  assert.equal(svar.metadata.modus, 'siste_datapunkt');
  assert.equal(svar.metadata.kun_lesing, true);
  assert.equal(svar.alarmer.length, 5);
});

test('deployer filtreres og sorteres med opprinnelige kilde-ID-er', async () => {
  const svar = await kall('sjekk_deploy_historikk', { tjeneste: 'sok', siden: '2026-10-23T00:00:00+02:00' });
  assert.deepEqual(svar.deployer.map((r) => r.versjon), ['3.9.1', '3.9.0']);
  for (const rad of svar.deployer) {
    assert.equal(rad.kilde_id, `DEPLOY-${String(dataDeployer.findIndex((r) => r.tid === rad.tid) + 1).padStart(3, '0')}`);
  }
  const likGrense = await kall('sjekk_deploy_historikk', { siden: '02:51:12' });
  assert.equal(likGrense.deployer.length, 1);
});

test('historikksøk dekker rotårsak og tiltak, men ikke fremtidige datoer', async () => {
  const svar = await kall('finn_lignende_hendelser', { tjeneste: 'kunde-db', tekst: 'MINNELEKKASJE' });
  assert.deepEqual(svar.hendelser.map((r) => r.kilde_id), ['INC-2026-014']);
  const tiltak = await kall('finn_lignende_hendelser', { tekst: 'reserveleverandør' });
  assert.deepEqual(tiltak.hendelser.map((r) => r.id), ['INC-2026-018']);
  const eldre = await verktøykall('2026-02-01T03:00:00+01:00')('finn_lignende_hendelser');
  assert.deepEqual(eldre.hendelser.map((r) => r.id), ['INC-2026-004']);
});

test('runbooks har proveniens og dato; versjoner fra fremtiden utelates', async () => {
  const svar = await kall('hent_runbook', { tjeneste: 'kunde-db' });
  assert.equal(svar.runbook.kilde_id, 'RUNBOOK-kunde-db');
  assert.equal(svar.runbook.sist_oppdatert, '2025-11-04');
  assert.equal(svar.runbook.fil, 'data/runbooks/kunde-db.md');
  assert.match(svar.runbook.innhold, /pgbouncer/);
  const tidlig = await verktøykall('2026-06-26T23:00:00+02:00')('hent_runbook', { tjeneste: 'sok' });
  assert.equal(tidlig.runbook, null);
  assert.deepEqual(tidlig.kilder, []);
});

test('runbook-oppslag avviser path traversal og ukjente filer', async () => {
  for (const tjeneste of ['../logger', '../../package', '/etc/passwd', 'kunde-db.md', '__proto__']) {
    await assert.rejects(kall('hent_runbook', { tjeneste }), /Ukjent tjeneste/);
  }
  await assert.rejects(kall('hent_runbook', { tjeneste: 'api-gateway' }), /Ingen runbook.*Tilgjengelige/);
  await assert.rejects(kall('hent_runbook'), /påkrevd/);
});

test('tjenestekartet viser eier, vakt, avhengigheter og udateringsbegrensning', async () => {
  const svar = await kall('hent_tjenesteinfo', { tjeneste: 'innlogging' });
  assert.equal(svar.tjenester[0].eier_team, 'Team Nøkkelknippe');
  assert.equal(svar.tjenester[0].vakt.primær, 'Hedda Uglevik');
  assert.deepEqual(svar.tjenester[0].avhengigheter, ['kunde-db', 'varsling']);
  assert.match(svar.metadata.merknad, /udatert/);
  assert.equal((await kall('hent_tjenesteinfo')).tjenester.length, 6);
});

test('alarmvalg bruker eksakt ID og inkluderer bare ønsket tidsvindu', async () => {
  const svar = await kall('hent_alarmer', { fra: '03:12', til: '03:31' });
  assert.deepEqual(svar.alarmer.map((r) => r.id), ['ALARM-0312', 'ALARM-0320', 'ALARM-0331']);
  const valgt = await kall('hent_alarmer', { id: 'ALARM-0340' });
  assert.equal(valgt.alarmer[0].kilde_id, 'ALARM-0340');
  await assert.rejects(kall('hent_alarmer', { id: 'ALARM-finnes-ikke' }), /Ukjent alarm/);
});

test('ugyldige filtre og sidestørrelser avvises i stedet for å brede ut søket', async () => {
  for (const input of [null, [], 'betaling', { tjeneste: 'ukjent' }, { niva: 'DEBUG' }, { niva: 2 },
    { fra: '03:20', til: '03:10' }, { fra: '2026-02-30T03:00:00Z' }, { tekst: 42 }, { tekst: '' },
    { maks: 0 }, { maks: 201 }, { maks: '10' }, { maks: 1.5 }, { maks: null },
    { offset: -1 }, { offset: 0.5 }, { offset: '0' }, { ved: '03:05' }, { typo: true }]) {
    await assert.rejects(kall('sok_i_logger', input), undefined, JSON.stringify(input));
  }
  for (const navn of ['hent_runbook', 'sjekk_deploy_historikk', 'finn_lignende_hendelser', 'hent_tjenesteinfo', 'hent_alarmer']) {
    await assert.rejects(kall(navn, { tjeneste: 'ukjent' }), /Ukjent tjeneste/);
    await assert.rejects(kall(navn, { ved: '03:05' }), /Ukjent argument/);
  }
  assert.throws(() => lagVerktøy({ ved: 'ikke en dato' }), /Ugyldig tidspunkt/);
  assert.throws(() => lagVerktøy({ ved: null }), /tekststreng/);
});

test('tomt søk er strukturert; eksterne mutasjoner påvirker ikke kildegrunnlaget', async () => {
  const tom = await kall('sok_i_logger', { tekst: 'dette finnes ikke i loggene' });
  assert.deepEqual(tom.logger, []);
  assert.deepEqual(tom.kilder, []);
  assert.equal(tom.metadata.total, 0);
  assert.match(tom.metadata.merknad, /beviser ikke/);
  const første = await kall('hent_tjenesteinfo', { tjeneste: 'betaling' });
  første.tjenester[0].vakt.primær = 'Endret';
  første.tjenester[0].avhengigheter.push('endret');
  const andre = await kall('hent_tjenesteinfo', { tjeneste: 'betaling' });
  assert.equal(andre.tjenester[0].vakt.primær, 'Sigrid Gravlund');
  assert.ok(!andre.tjenester[0].avhengigheter.includes('endret'));
});
