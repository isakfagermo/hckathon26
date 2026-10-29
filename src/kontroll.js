// Deterministisk kontrollgrunnlag. Dette er ikke en semantisk faktasjekker.
export function lagKontrollgrunnlag({ kilder, spor, ved }) {
  const verdier = [...kilder.values()];
  const loggsøk = spor.filter(e => e.type === 'verktoy' && e.navn === 'sok_i_logger' && !e.feil);
  const avgrensninger = loggsøk.filter(e => e.input.fra || e.input.tekst || e.input.niva || e.resultat?.metadata?.avkortet)
    .map(e => ({ filtre: e.input, avkortet: !!e.resultat?.metadata?.avkortet,
      merknad: 'Første treff i dette søket beviser ikke når hendelsen startet. Hent tidligere/ufiltrerte logger eller avgrens påstanden.' }));
  const tidslinjer = [...new Set(verdier.filter(k => k.kilde_id.startsWith('LOG-')).map(k => k.tjeneste))].map(tjeneste => {
    const feil = verdier.filter(k => k.kilde_id.startsWith('LOG-') && k.tjeneste === tjeneste && k.nivå === 'ERROR')
      .sort((a, b) => Date.parse(a.tid) - Date.parse(b.tid));
    if (!feil.length) return null;
    const første = feil[0];
    return { tjeneste, første_hentede_feil: første.tid, kilde_id: første.kilde_id,
      sekunder_til_datagrense: (Date.parse(ved) - Date.parse(første.tid)) / 1000,
      tretti_minutter_etter: new Date(Date.parse(første.tid) + 30 * 60000).toISOString(),
      merknad: 'Beregnet fra første HENTEDE feil, ikke nødvendigvis faktisk hendelsesstart. 30 minutter er et regneeksempel; eskaleringsterskel må hentes fra runbook.' };
  }).filter(Boolean);
  return {
    avgrensninger, tidslinjer,
    sjekkliste: [
      'Prøv å motbevise hovedhypotesen. Hent målrettet belegg hvis det kan endre konklusjonen.',
      'Kontroller alle faktapåstander mot de oppgitte kildene; fjern udokumenterte påstander.',
      'Sjekk at første feil ikke bare er første treff i et filtrert søk.',
      'Beregn varighet ved datagrensen. Ikke anbefal eskalering som om en fremtidig tidsgrense allerede er nådd.',
      'Kryssjekk runbookens forutsetninger. En dato alene beviser ikke at rådene er feil.',
      'Krev aggregert måling før friskmelding; enkeltkall beviser ikke normal drift.',
    ],
  };
}
