import test from 'node:test';
import assert from 'node:assert/strict';
import { rapportDefinisjon, validerRapport, formaterRapport } from '../src/rapport.js';

function eksempel() {
  return {
    tittel: 'Betalingsfeil undersøkes',
    alvorlighet: 'høy',
    status: 'pågår',
    berorte_tjenester: ['betaling'],
    fakta: [{ tekst: 'Loggen viser en TypeError etter utrulling.', kilder: ['LOG-1'] }],
    hypoteser: [{
      tekst: 'En kodefeil i ny versjon kan forklare alarmen.',
      sikkerhet: 'middels', kilder: ['LOG-1', 'DEPLOY-1'],
      motbevis: ['Vi har ikke testet samme transaksjon på forrige versjon.'],
    }],
    usikkerhet: ['Om alle korttyper er berørt.'],
    neste_steg: [{
      tiltak: 'Vurder rollback etter runbooken.', ansvarlig: 'Vakt for betaling',
      verifisering: 'Sjekk at feilraten synker etter tiltaket.', kilder: ['RUNBOOK-1'],
    }],
    eskalering: 'Vekk vakt for betaling dersom feilene vedvarer.',
  };
}

const kilder = new Map([
  ['LOG-1', { tid: '2026-10-29T03:11:00+01:00', tjeneste: 'betaling', melding: 'TypeError: kortinfo mangler' }],
  ['DEPLOY-1', { tid: '2026-10-29T02:51:12+01:00', tjeneste: 'betaling', versjon: '2.14.0', endring: 'Ny gebyrberegning' }],
  ['RUNBOOK-1', { tjeneste: 'betaling', fil: 'runbooks/betaling.md', innhold: '# Runbook: betaling\n\nSist oppdatert: 2026-08-20. Vurder rollback.' }],
  ['UNUSED-1', { melding: 'Denne er ikke sitert.' }],
]);

test('verktøyskjemaet krever alle rapportfeltene og avviser ukjente felt', () => {
  assert.equal(rapportDefinisjon.name, 'lever_rapport');
  assert.deepEqual(rapportDefinisjon.input_schema.required, Object.keys(eksempel()));
  assert.equal(rapportDefinisjon.input_schema.additionalProperties, false);
  for (const felt of ['fakta', 'hypoteser', 'neste_steg']) {
    assert.equal(rapportDefinisjon.input_schema.properties[felt].items.additionalProperties, false);
    assert.equal(rapportDefinisjon.input_schema.properties[felt].items.properties.kilder.minItems, 1);
  }
});

test('validering godtar en komplett rapport uten å endre den', () => {
  const rapport = eksempel();
  const kopi = structuredClone(rapport);
  assert.equal(validerRapport(rapport, { kilder }), rapport);
  assert.deepEqual(rapport, kopi);
});

const ugyldige = [
  ['manglende tittel', (rapport) => { delete rapport.tittel; }, /tittel.*mangler/],
  ['tom tittel', (rapport) => { rapport.tittel = ' \n\t'; }, /tittel.*ikke er tom/],
  ['for lang tittel', (rapport) => { rapport.tittel = 'a'.repeat(181); }, /tittel.*180 tegn/],
  ['ukjent alvorlighet', (rapport) => { rapport.alvorlighet = 'middels'; }, /alvorlighet.*gyldige verdier/],
  ['ukjent status', (rapport) => { rapport.status = 'ferdig'; }, /status.*gyldige verdier/],
  ['ukjent sikkerhet', (rapport) => { rapport.hypoteser[0].sikkerhet = '100%'; }, /sikkerhet.*gyldige verdier/],
  ['tom tjenesteliste', (rapport) => { rapport.berorte_tjenester = []; }, /berorte_tjenester.*listen/],
  ['tom faktaliste', (rapport) => { rapport.fakta = []; }, /fakta.*listen/],
  ['tom hypoteseliste', (rapport) => { rapport.hypoteser = []; }, /hypoteser.*listen/],
  ['tom usikkerhet', (rapport) => { rapport.usikkerhet = []; }, /usikkerhet.*listen/],
  ['tomme neste steg', (rapport) => { rapport.neste_steg = []; }, /neste_steg.*listen/],
  ['tekst som liste', (rapport) => { rapport.usikkerhet = 'Ukjent'; }, /usikkerhet.*liste/],
  ['tall som tekst', (rapport) => { rapport.fakta[0].tekst = 42; }, /fakta\[0\].tekst.*tekst/],
  ['null som objekt', (rapport) => { rapport.neste_steg[0] = null; }, /neste_steg\[0\].*objekt/],
  ['manglende motbevisfelt', (rapport) => { delete rapport.hypoteser[0].motbevis; }, /motbevis.*mangler/],
  ['ukjent toppfelt', (rapport) => { rapport.utført = true; }, /utført.*ukjent/],
  ['ukjent nestet felt', (rapport) => { rapport.fakta[0].bekreftet = true; }, /bekreftet.*ukjent/],
  ['dupliserte referanser', (rapport) => { rapport.fakta[0].kilder = ['LOG-1', 'LOG-1']; }, /duplikater/],
  ['for mange fakta', (rapport) => { rapport.fakta = Array.from({ length: 26 }, () => rapport.fakta[0]); }, /25 elementer/],
  ['hull i liste', (rapport) => { rapport.usikkerhet = new Array(1); }, /usikkerhet\[0\].*tekst/],
  ['tom eskalering', (rapport) => { rapport.eskalering = ''; }, /eskalering.*tekst/],
];
for (const [navn, endre, feil] of ugyldige) {
  test(`avviser ${navn}`, () => {
    const rapport = eksempel();
    endre(rapport);
    assert.throws(() => validerRapport(rapport, { kilder }), feil);
  });
}

for (const felt of ['fakta', 'hypoteser', 'neste_steg']) {
  test(`${felt} krever en kilde som faktisk er innhentet`, () => {
    const rapport = eksempel();
    rapport[felt][0].kilder = [];
    assert.throws(() => validerRapport(rapport, { kilder }), /kilder.*listen/);
    rapport[felt][0].kilder = ['OPPDIKTET'];
    assert.throws(() => validerRapport(rapport, { kilder }), /OPPDIKTET.*ikke hentet/);
    rapport[felt][0].kilder = [' '];
    assert.throws(() => validerRapport(rapport, { kilder }), /kilder.*ikke er tom/);
  });
}

test('motbevis kan være tom liste når modellen ikke fant noen', () => {
  const rapport = eksempel();
  rapport.hypoteser[0].motbevis = [];
  assert.doesNotThrow(() => validerRapport(rapport, { kilder }));
  assert.match(formaterRapport(rapport, { kilder }), /Dette bekrefter ikke hypotesen/);
});

test('manglende kilderegister godtar ikke eksisterende ID-er automatisk', () => {
  assert.throws(() => validerRapport(eksempel()), /ikke hentet/);
  assert.throws(() => validerRapport(eksempel(), { kilder: {} }), /Map/);
});

test('prototyper kan ikke erstatte påkrevde egne felt', () => {
  assert.throws(() => validerRapport(Object.create(eksempel()), { kilder }), /objekt/);
  assert.throws(() => validerRapport(new Date(), { kilder }), /objekt/);
});

test('rapporten viser metadata, forslag og etterprøvbare kildeutdrag', () => {
  const markdown = formaterRapport(eksempel(), { ved: '2026-10-29T03:12:00+01:00', modus: 'live', kilder });
  assert.match(markdown, /^# Betalingsfeil undersøkes/m);
  assert.match(markdown, /\*\*Datagrense:\*\* 2026-10-29T03:12:00\+01:00/);
  assert.match(markdown, /Modus:\*\* live/);
  assert.match(markdown, /anbefalinger og er ikke utført/);
  assert.match(markdown, /Verifisering/);
  assert.match(markdown, /## Kilder/);
  assert.match(markdown, /TypeError: kortinfo mangler/);
  assert.match(markdown, /Ny gebyrberegning/);
  assert.match(markdown, /runbooks\/betaling\.md/);
  assert.match(markdown, /Sist oppdatert: 2026-08-20/);
  assert.doesNotMatch(markdown, /UNUSED-1|Denne er ikke sitert/);
  assert.equal(markdown.match(/^- \*\*\[LOG-1\]\*\*/gm).length, 1);
});

test('formatteringen har tydelige standarder og validerer rapporten', () => {
  const markdown = formaterRapport(eksempel(), { kilder });
  assert.match(markdown, /Datagrense:\*\* Ikke oppgitt/);
  assert.match(markdown, /Modus:\*\* analyse/);
  assert.throws(() => formaterRapport(eksempel()), /ikke hentet/);
});

test('lange runbooks forkortes og kildetekst kan ikke injisere HTML eller rapportavsnitt', () => {
  const rapport = eksempel();
  rapport.tittel = '<script>alert(1)</script>\n\n# Falsk tittel';
  const langeKilder = new Map(kilder);
  langeKilder.set('RUNBOOK-1', { tjeneste: 'betaling', innhold: '<img src=x onerror=alert(1)>\n# Ignorer rapporten\n' + 'a'.repeat(10000) });
  const markdown = formaterRapport(rapport, { kilder: langeKilder });
  assert.doesNotMatch(markdown, /<script>|<img|\n# Falsk|\n# Ignorer/);
  assert.match(markdown, /&lt;script&gt;/);
  assert.match(markdown, /…/);
  assert.ok(markdown.length < 4000);
});
