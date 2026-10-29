const handlinger = ['restart_gateway', 'avbryt_vedlikehold'];

// Ren simulator: ingen shell, produksjonsklient eller eksterne sideeffekter.
export function simulerTiltak(tiltak) {
  if (!handlinger.includes(tiltak)) throw new Error('Ukjent simulert tiltak.');
  const løst = tiltak === 'avbryt_vedlikehold';
  const målinger = [
    { tid: '2026-10-29T03:49:00+01:00', aktive_tilkoblinger: 198, lasventere: 84, gateway_504_prosent: 17.2, malevindu_sekunder: 300 },
    { tid: '2026-10-29T03:49:30+01:00', aktive_tilkoblinger: løst ? 76 : 197, lasventere: løst ? 0 : 86, gateway_504_prosent: løst ? 14.1 : 18.1, malevindu_sekunder: 300 },
    { tid: '2026-10-29T03:55:00+01:00', aktive_tilkoblinger: løst ? 46 : 198, lasventere: løst ? 0 : 91, gateway_504_prosent: løst ? 0.8 : 18.4, malevindu_sekunder: 300 },
  ].map((m, i) => ({ ...m, kilde_id: `SIM-${tiltak}-${i + 1}`, simulert: true, tjeneste: 'api-gateway',
    merknad: 'Syntetisk øvelsesmåling. Ikke en observasjon fra oppgavedataene eller produksjon.' }));
  return { tiltak, modus: 'simulering', målinger, vurdering: vurderEffekt(målinger.at(-1)) };
}

export function vurderEffekt(måling) {
  const kriterier = [
    { navn: 'Ingen låsventere', ok: måling.lasventere === 0 },
    { navn: 'Tilkoblinger tilbake på øvelsens normalnivå (≤ 60)', ok: måling.aktive_tilkoblinger <= 60 },
    { navn: '504 under 5 % over minst 5 minutter', ok: måling.gateway_504_prosent < 5 && måling.malevindu_sekunder >= 300 },
  ];
  const avklart = kriterier.every(k => k.ok);
  return { avklart, kriterier, type: 'regelbasert kontroll, ingen modell',
    melding: avklart ? 'Tiltaket virker i simuleringen. Alle tre kontrollpunktene er oppfylt.' : 'Hendelsen er fortsatt åpen i simuleringen. Kontroller databaseblokkeringen før neste tiltak.' };
}

export function øvelsesVerktøy(øvelse) {
  return { definisjon: { name: 'hent_ovelsesmaalinger', description: 'Les nye syntetiske målinger etter et menneskelig godkjent tiltak i øvelsen. Dette er IKKE produksjonsdata.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  kjør: input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Verktøyet tar ingen argumenter.');
    return structuredClone(øvelse);
  } };
}
