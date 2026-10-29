import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lesAlternativer } from '../src/index.js';
import { lagVerktøy, standardVed } from '../src/verktoy.js';

const prosjekt = fileURLToPath(new URL('../', import.meta.url));
const inngang = path.join(prosjekt, 'src/index.js');
const konfigVariabler = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'MODELL',
  'MAX_ITERASJONER', 'MAX_VERKTOYKALL', 'MAX_TOKENS', 'MAX_TOTAL_TOKENS', 'API_TIMEOUT_MS', 'MAKS_VARIGHET_MS', 'NODE_OPTIONS'];

function arbeidsmappe(t) {
  const mappe = fs.mkdtempSync(path.join(os.tmpdir(), 'natteskiftet-cli-'));
  t.after(() => fs.rmSync(mappe, { recursive: true, force: true }));
  return mappe;
}

function kjør(args, cwd, entry = inngang) {
  const env = { ...process.env };
  for (const variabel of konfigVariabler) delete env[variabel];
  return spawnSync(process.execPath, [entry, ...args], {
    cwd, env, encoding: 'utf8', timeout: 15000, maxBuffer: 5 * 1024 * 1024,
  });
}

function vellykket(resultat) {
  assert.ifError(resultat.error);
  assert.equal(resultat.status, 0, resultat.stderr);
}

test('CLI parser valg og fri alarmtekst uten sideeffekter', () => {
  assert.equal(lesAlternativer([]).oppgave, '');
  assert.equal(lesAlternativer(['ALARM', 'betaling', 'feiler']).oppgave, 'ALARM betaling feiler');
  const valg = lesAlternativer(['--alarm', 'sok', '--ved', '03:20', '--json', '--stille']);
  assert.equal(valg.alarm, 'sok');
  assert.equal(valg.ved, '03:20');
  assert.equal(valg.json, true);
  assert.equal(valg.stille, true);
  assert.equal(lesAlternativer(['-h']).help, true);
});

test('CLI avviser konflikter, ukjente valg, manglende verdier og tomme eksportstier', () => {
  for (const args of [
    ['--alarm', 'sok', '--alle'], ['--demo', '--ved', '03:05'],
    ['--demo', 'fri alarmtekst'], ['--alarm', 'sok', 'fri alarmtekst'], ['--alle', 'fri alarmtekst'],
    ['--liste', 'fri alarmtekst'], ['--liste', '--demo'], ['--liste', '--ut', 'fil.md'],
    ['--liste', '--spor', 'spor.json'], ['--liste', '--alarm', 'sok'], ['--liste', '--alle'],
    ['--ut', 'same.md', '--spor', './same.md'], ['--ukjent'], ['--alarm'], ['--json=ja'],
    ['--alarm', ' '], ['--ved', ''], ['--ut', ' '], ['--spor', ''],
  ]) {
    assert.throws(() => lesAlternativer(args), undefined, JSON.stringify(args));
  }
});

test('hjelp og alarmliste fungerer i isolert prosjekt uten node_modules eller API-nøkkel', (t) => {
  const isolert = arbeidsmappe(t);
  fs.cpSync(path.join(prosjekt, 'src'), path.join(isolert, 'src'), { recursive: true });
  fs.cpSync(path.join(prosjekt, 'data'), path.join(isolert, 'data'), { recursive: true });
  fs.copyFileSync(path.join(prosjekt, 'package.json'), path.join(isolert, 'package.json'));
  const entry = path.join(isolert, 'src/index.js');
  assert.equal(fs.existsSync(path.join(isolert, 'node_modules')), false);
  const hjelp = kjør(['--help'], isolert, entry);
  vellykket(hjelp);
  assert.match(hjelp.stdout, /NATTESKIFTET/);
  assert.match(hjelp.stdout, /--ved/);
  assert.equal(hjelp.stderr, '');
  const liste = kjør(['--liste', '--json'], isolert, entry);
  vellykket(liste);
  const data = JSON.parse(liste.stdout);
  assert.equal(data.alarmer.length, 5);
  assert.equal(liste.stderr, '');
});

test('--ved skjuler fremtidige alarmer i maskinlesbar liste', (t) => {
  const cwd = arbeidsmappe(t);
  const resultat = kjør(['--liste', '--ved', '03:05', '--json'], cwd);
  vellykket(resultat);
  const svar = JSON.parse(resultat.stdout);
  assert.deepEqual(svar.alarmer.map((a) => a.id), ['ALARM-0305']);
  assert.equal(svar.metadata.ved, '2026-10-29T02:05:00.000Z');
  const tom = kjør(['--liste', '--ved', '02:00'], cwd);
  vellykket(tom);
  assert.match(tom.stdout, /Ingen alarmer før/);
});

test('valg av fremtidig, ukjent eller manglende alarm feiler før API-konfigurasjon', (t) => {
  const cwd = arbeidsmappe(t);
  for (const args of [['--alarm', 'betaling', '--ved', '03:05'], ['--alarm', 'finnes-ikke'], ['--alle', '--ved', '02:00']]) {
    const resultat = kjør(args, cwd);
    assert.equal(resultat.status, 1);
    assert.match(resultat.stderr, /Fant ikke alarm|Ingen alarmer å analysere/);
    assert.doesNotMatch(resultat.stderr, /Mangler ANTHROPIC_API_KEY/);
    assert.equal(resultat.stdout, '');
  }
});

test('modellmodus uten nøkkel gir nyttig feil og starter ikke API-kall', (t) => {
  const resultat = kjør(['--alarm', 'betaling'], arbeidsmappe(t));
  assert.equal(resultat.status, 1);
  assert.match(resultat.stderr, /Mangler ANTHROPIC_API_KEY/);
  assert.match(resultat.stderr, /demo/);
  assert.equal(resultat.stdout, '');
});

test('.env leses før modellkonfigurasjonen uten å lekke nøkkelen', (t) => {
  const cwd = arbeidsmappe(t);
  const fakeNøkkel = 'sk-test-only-no-network-natteskiftet';
  fs.writeFileSync(path.join(cwd, '.env'), `ANTHROPIC_API_KEY=${fakeNøkkel}\nMAX_ITERASJONER=0\n`, { mode: 0o600 });
  const resultat = kjør(['--alarm', 'betaling'], cwd);
  assert.equal(resultat.status, 1);
  assert.match(resultat.stderr, /MAX_ITERASJONER må være et heltall/);
  assert.doesNotMatch(resultat.stderr, /Mangler ANTHROPIC_API_KEY|sk-test-only/);
  assert.equal(resultat.stdout, '');
});

test('CLI nekter å overskrive rapport og spor før undersøkelsen starter', (t) => {
  const cwd = arbeidsmappe(t);
  const mål = path.join(cwd, 'behold.txt');
  const opprinnelig = 'Eksisterende arbeid skal bevares.\n';
  fs.writeFileSync(mål, opprinnelig);
  for (const flagg of ['--ut', '--spor']) {
    const resultat = kjør(['--demo', flagg, mål], cwd);
    assert.equal(resultat.status, 1);
    assert.match(resultat.stderr, /Filen finnes allerede/);
    assert.equal(resultat.stdout, '');
    assert.equal(fs.readFileSync(mål, 'utf8'), opprinnelig);
  }
  const manglerMappe = kjør(['--demo', '--ut', path.join(cwd, 'finnes-ikke', 'rapport.md')], cwd);
  assert.equal(manglerMappe.status, 1);
  assert.match(manglerMappe.stderr, /Mappen finnes ikke/);
});

test('demomodusen avviser en tidligere observasjonstid både i CLI og direkte API', async (t) => {
  const resultat = kjør(['--demo', '--ved', '03:05'], arbeidsmappe(t));
  assert.equal(resultat.status, 1);
  assert.match(resultat.stderr, /--demo bruker siste observasjonstidspunkt/);
  const { kjørDemo } = await import('../src/demo.js');
  await assert.rejects(kjørDemo({ alarmId: 'ALARM-0312', verktøy: lagVerktøy({ ved: '03:05' }), ved: '2026-10-29T03:05:00+01:00' }), /bare siste observasjonstidspunkt/);
});

test('demo for alle fem alarmer skriver ren JSON og holder fremdrift på stderr', (t) => {
  const resultat = kjør(['--demo', '--alle', '--json'], arbeidsmappe(t));
  vellykket(resultat);
  const data = JSON.parse(resultat.stdout);
  assert.equal(data.observasjonstidspunkt, standardVed);
  assert.equal(data.resultater.length, 5);
  assert.match(resultat.stderr, /KURATERT REFERANSEDEMO/);
  for (const r of data.resultater) {
    assert.equal(r.status, 'ok');
    assert.equal(r.iterasjoner, 0);
    assert.equal(r.modell, null);
    assert.equal(r.bruk.input_tokens + r.bruk.output_tokens, 0);
    assert.match(r.modus, /ingen modell kjørt/);
    assert.ok(r.rapport);
    assert.ok(r.kilder.length > 0);
    assert.ok(r.spor.length > 0);
  }
});

test('demo velger tjenestealarm, kan være stille og eksporterer JSON til nye filer', (t) => {
  const cwd = arbeidsmappe(t);
  const ut = path.join(cwd, 'rapport.json');
  const spor = path.join(cwd, 'spor.json');
  const resultat = kjør(['--demo', '--alarm', 'varsling', '--json', '--stille', '--ut', ut, '--spor', spor], cwd);
  vellykket(resultat);
  assert.equal(resultat.stderr, '');
  const data = JSON.parse(resultat.stdout);
  assert.equal(data.resultater.length, 1);
  assert.equal(data.resultater[0].alarmId, 'ALARM-0331');
  assert.deepEqual(JSON.parse(fs.readFileSync(ut, 'utf8')), data);
  assert.deepEqual(JSON.parse(fs.readFileSync(spor, 'utf8')), data);
  assert.equal(fs.statSync(ut).mode & 0o777, 0o600);
  assert.equal(fs.statSync(spor).mode & 0o777, 0o600);
});
