// Rapporten valideres mot samme skjema som modellen får. Referansesjekken
// bekrefter at kilden er lest, ikke at kilden underbygger modellens tolkning.
const tekst = (maxLength = 1600) => ({ type: 'string', minLength: 1, maxLength });
const liste = (items, minItems = 1, maxItems = 20) => ({ type: 'array', items, minItems, maxItems });
const objekt = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const kildeListe = {
  ...liste(tekst(160), 1, 20),
  uniqueItems: true,
  description: 'ID-er fra vellykkede verktøysvar som støtter akkurat denne påstanden eller anbefalingen.',
};

export const rapportDefinisjon = {
  name: 'lever_rapport',
  description:
    'Lever en kort, etterprøvbar situasjonsrapport på norsk når undersøkelsen er ferdig. ' +
    'Skill observerte fakta fra hypoteser. Bruk bare kilde-ID-er du har mottatt i vellykkede verktøysvar. ' +
    'Oppgi konkurrerende forklaringer og motbevis, hva som fortsatt er ukjent, hvem som bør handle, ' +
    'og hvordan hvert foreslått tiltak skal verifiseres. Tiltakene er anbefalinger og er ikke utført.',
  input_schema: objekt({
    tittel: tekst(180),
    alvorlighet: { type: 'string', enum: ['kritisk', 'høy', 'advarsel', 'informasjon'] },
    status: { type: 'string', enum: ['pågår', 'avklart', 'uavklart'] },
    berorte_tjenester: { ...liste(tekst(100), 1, 12), uniqueItems: true },
    fakta: liste(objekt({ tekst: tekst(), kilder: kildeListe }), 1, 25),
    hypoteser: liste(objekt({
      tekst: tekst(),
      sikkerhet: { type: 'string', enum: ['høy', 'middels', 'lav'] },
      kilder: kildeListe,
      motbevis: liste(tekst(1000), 0, 10),
    }), 1, 6),
    usikkerhet: liste(tekst(), 1, 16),
    neste_steg: liste(objekt({
      tiltak: tekst(1400),
      ansvarlig: tekst(240),
      verifisering: tekst(1200),
      kilder: kildeListe,
    }), 1, 15),
    eskalering: tekst(),
  }),
};

function ugyldig(sti, melding) {
  throw new TypeError(`Ugyldig rapport (${sti}): ${melding}.`);
}

function validerVerdi(verdi, skjema, sti) {
  if (skjema.type === 'object') {
    if (verdi === null || typeof verdi !== 'object' || Array.isArray(verdi)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(verdi))) {
      ugyldig(sti, 'forventet et objekt');
    }
    for (const felt of Object.keys(verdi)) {
      if (!Object.hasOwn(skjema.properties, felt)) ugyldig(`${sti}.${felt}`, 'ukjent felt');
    }
    for (const felt of skjema.required) {
      if (!Object.hasOwn(verdi, felt)) ugyldig(`${sti}.${felt}`, 'obligatorisk felt mangler');
      validerVerdi(verdi[felt], skjema.properties[felt], `${sti}.${felt}`);
    }
  } else if (skjema.type === 'array') {
    if (!Array.isArray(verdi)) ugyldig(sti, 'forventet en liste');
    if (verdi.length < skjema.minItems || verdi.length > skjema.maxItems) {
      ugyldig(sti, `listen må ha mellom ${skjema.minItems} og ${skjema.maxItems} elementer`);
    }
    for (const [i, element] of verdi.entries()) validerVerdi(element, skjema.items, `${sti}[${i}]`);
    if (skjema.uniqueItems && new Set(verdi).size !== verdi.length) ugyldig(sti, 'duplikater er ikke tillatt');
  } else if (skjema.type === 'string') {
    if (typeof verdi !== 'string' || !verdi.trim()) ugyldig(sti, 'forventet tekst som ikke er tom');
    if (skjema.maxLength && [...verdi].length > skjema.maxLength) {
      ugyldig(sti, `teksten kan ha høyst ${skjema.maxLength} tegn`);
    }
    if (skjema.enum && !skjema.enum.includes(verdi)) ugyldig(sti, `gyldige verdier er ${skjema.enum.join(', ')}`);
  }
}

/** Validerer struktur og kilde-ID-er; dette er ingen semantisk faktasjekk. */
export function validerRapport(rapport, { kilder = new Map() } = {}) {
  if (!(kilder instanceof Map)) throw new TypeError('kilder må være en Map med innhentede kilder.');
  validerVerdi(rapport, rapportDefinisjon.input_schema, 'rapport');
  for (const felt of ['fakta', 'hypoteser', 'neste_steg']) {
    for (const [i, punkt] of rapport[felt].entries()) {
      for (const id of punkt.kilder) {
        if (!kilder.has(id)) ugyldig(`rapport.${felt}[${i}].kilder`, `kilden «${id}» er ikke hentet`);
      }
    }
  }
  return rapport;
}

// Kildetekst og modelltekst vises som tekst, også når de inneholder Markdown/HTML.
function visTekst(verdi, maks = Infinity) {
  const ren = String(verdi).replace(/\s+/gu, ' ').trim();
  const tegn = [...ren];
  const kort = tegn.length > maks ? `${tegn.slice(0, maks).join('')}…` : ren;
  return kort.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*{}\[\]_]/g, '\\$&');
}

const referanser = (ids) => ids.map((id) => `[${visTekst(id)}]`).join(' ');

function kildeUtdrag(kilde) {
  if (!kilde || typeof kilde !== 'object') return visTekst(kilde ?? 'Ingen kildebeskrivelse.', 500);
  const felter = ['fil', 'tid', 'dato', 'sist_oppdatert', 'tjeneste', 'navn', 'nivå', 'versjon', 'tittel', 'melding', 'endring', 'beskrivelse'];
  const deler = felter.filter((felt) => typeof kilde[felt] === 'string' && kilde[felt].trim())
    .map((felt) => `${felt}: ${visTekst(kilde[felt], 500)}`);
  // Runbooks og hendelser har ofte lange tekster. Behold et kort utdrag som
  // identifiserer kilden; den komplette teksten finnes i verktøysporet.
  for (const felt of ['innhold', 'sammendrag', 'rotårsak']) {
    if (typeof kilde[felt] === 'string' && kilde[felt].trim()) deler.push(`${felt}: ${visTekst(kilde[felt], 500)}`);
  }
  return deler.join(' · ') || 'Kilde registrert i verktøysporet.';
}

/** Formaterer en validert rapport med de faktiske, siterte verktøykildene. */
export function formaterRapport(rapport, { ved = 'Ikke oppgitt', modus = 'analyse', kilder = new Map() } = {}) {
  validerRapport(rapport, { kilder });
  const linjer = [
    `# ${visTekst(rapport.tittel)}`,
    '',
    `**Alvorlighet:** ${visTekst(rapport.alvorlighet)} · **Status:** ${visTekst(rapport.status)}`,
    `**Berørte tjenester:** ${rapport.berorte_tjenester.map((tjeneste) => visTekst(tjeneste)).join(', ')}`,
    `**Datagrense:** ${visTekst(ved)} · **Modus:** ${visTekst(modus)}`,
    '',
    '## Observerte fakta',
    '',
    ...rapport.fakta.map((punkt) => `- ${visTekst(punkt.tekst)} ${referanser(punkt.kilder)}`),
    '',
    '## Hypoteser og motbevis',
    '',
  ];
  for (const hypotese of rapport.hypoteser) {
    linjer.push(`- **${visTekst(hypotese.sikkerhet)} sikkerhet:** ${visTekst(hypotese.tekst)} ${referanser(hypotese.kilder)}`);
    linjer.push(`  Motbevis / begrensninger: ${hypotese.motbevis.length
      ? hypotese.motbevis.map((motbevis) => visTekst(motbevis)).join('; ')
      : 'Ingen oppgitt. Dette bekrefter ikke hypotesen.'}`);
  }
  linjer.push('', '## Det vi ikke vet', '', ...rapport.usikkerhet.map((punkt) => `- ${visTekst(punkt)}`),
    '', '## Foreslåtte neste steg', '', 'Tiltakene nedenfor er anbefalinger og er ikke utført av agenten.', '');
  for (const [i, steg] of rapport.neste_steg.entries()) {
    linjer.push(`${i + 1}. ${visTekst(steg.tiltak)} ${referanser(steg.kilder)}`,
      `   **Ansvarlig:** ${visTekst(steg.ansvarlig)}. **Verifisering:** ${visTekst(steg.verifisering)}`);
  }
  linjer.push('', '## Eskalering', '', visTekst(rapport.eskalering), '', '## Kilder', '');
  const siterte = new Set([...rapport.fakta, ...rapport.hypoteser, ...rapport.neste_steg].flatMap((punkt) => punkt.kilder));
  for (const id of siterte) linjer.push(`- **${referanser([id])}** ${kildeUtdrag(kilder.get(id))}`);
  return `${linjer.join('\n')}\n`;
}
