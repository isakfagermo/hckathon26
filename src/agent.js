import { rapportDefinisjon, validerRapport } from './rapport.js';

function heltall(env, navn, standard, min, maks) {
  const verdi = env[navn] === undefined ? standard : Number(env[navn]);
  if (!Number.isInteger(verdi) || verdi < min || verdi > maks) {
    throw new Error(`${navn} må være et heltall mellom ${min} og ${maks}.`);
  }
  return verdi;
}

// Les konfig etter .env. Ingen klient eller konfig opprettes ved import.
export function lesAgentKonfig(env = process.env) {
  const modell = env.MODELL ?? 'claude-sonnet-5-5';
  if (!modell.trim()) throw new Error('MODELL kan ikke være tom.');
  return {
    modell,
    maxIterasjoner: heltall(env, 'MAX_ITERASJONER', 10, 1, 50),
    maxVerktoykall: heltall(env, 'MAX_VERKTOYKALL', 40, 1, 100),
    maxTokens: heltall(env, 'MAX_TOKENS', 6000, 256, 16000),
    maxTotalTokens: heltall(env, 'MAX_TOTAL_TOKENS', 80000, 256, 500000),
    timeoutMs: heltall(env, 'API_TIMEOUT_MS', 45000, 1000, 120000),
    varighetMs: heltall(env, 'MAKS_VARIGHET_MS', 180000, 1000, 600000),
  };
}

export function samleKilder(data, kilder = new Map()) {
  if (!data || typeof data !== 'object') return kilder;
  if (!Array.isArray(data) && typeof data.kilde_id === 'string') kilder.set(data.kilde_id, structuredClone(data));
  for (const verdi of Object.values(data)) samleKilder(verdi, kilder);
  return kilder;
}

function stabilJSON(verdi) {
  if (Array.isArray(verdi)) return `[${verdi.map(stabilJSON).join(',')}]`;
  if (verdi && typeof verdi === 'object') {
    return `{${Object.keys(verdi).sort().map(k => `${JSON.stringify(k)}:${stabilJSON(verdi[k])}`).join(',')}}`;
  }
  return JSON.stringify(verdi);
}

function medAvbrudd(operasjon, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const avbryt = () => reject(signal.reason);
    signal.addEventListener('abort', avbryt, { once: true });
    Promise.resolve().then(operasjon).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', avbryt));
  });
}

function feiltekst(feil) {
  // Ikke skriv ut rå API-feil, som kan inneholde forespørsler og autentisering.
  if (feil?.name === 'TimeoutError' || feil?.name === 'APIConnectionTimeoutError') return 'Tidsgrensen ble nådd.';
  if (feil?.name === 'AbortError') return 'Kjøringen ble avbrutt.';
  if (feil?.status === 401) return 'API-et avviste autentiseringen (401). Kontroller ANTHROPIC_API_KEY.';
  if (feil?.status === 429) return 'API-ets rate- eller kvotegrense ble nådd (429). Prøv senere.';
  if (Number.isInteger(feil?.status)) return `API-kallet feilet (HTTP ${feil.status}). Kontroller modell, tilgang og API-status.`;
  return 'API-kallet feilet. Kontroller nettverk, modell og API-konfigurasjon.';
}

export async function kjørAgent({
  system, oppgave, verktøy, ved, klient, konfig = lesAgentKonfig(),
  signal = new AbortController().signal, onEvent = () => {},
}) {
  if (!klient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    klient = new Anthropic({ timeout: konfig.timeoutMs, maxRetries: 1 });
  }
  const aktive = verktøy.filter(v => typeof v.kjør === 'function');
  // Sonnet 5.5 binder signerte thinking-blokker til både system, verktøy og historikk.
  // Hold prefikset uendret; nye begrensninger legges til som meldinger.
  const definisjoner = [...aktive.map(v => v.definisjon), rapportDefinisjon];
  const etterNavn = new Map(aktive.map(v => [v.definisjon.name, v]));
  const kilder = new Map();
  const cache = new Map();
  const spor = [];
  const bruk = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const messages = [{ role: 'user', content: oppgave }];
  const fristSignal = AbortSignal.any([signal, AbortSignal.timeout(konfig.varighetMs)]);
  let iterasjoner = 0;
  let verktoykall = 0;
  let lesebudsjettStengt = false;
  let budsjettvarselSendt = false;
  const totalTokens = () => Object.values(bruk).reduce((a, b) => a + b, 0);
  const ferdig = (status, årsak, rapport = null) => ({
    status, årsak, rapport, ved, modus: 'modell', modell: konfig.modell,
    iterasjoner, verktoykall, bruk, kilder: [...kilder.values()], spor,
  });
  const emit = event => { spor.push(event); onEvent(event); };
  const fullSystem = `${system}\n\nObservasjonstidspunkt: ${ved}. Dette er et statisk datasett; rapporter aldri dagens produksjonsstatus.
Du har kun lesetilgang. Ingen tiltak, utrullinger eller varsler kan utføres.
Avslutt ved å kalle lever_rapport alene, aldri med bare fri tekst. Rapporten må ha kilde-ID-er fra verktøysvarene du faktisk har lest.
Hent alarm, relevante logger, avhengigheter/eierskap, endringshistorikk og ved behov runbooks og lignende hendelser før rapporten.
Oppgi bekreftede fakta og alternative hypoteser/motbevis, hva som mangler, ansvarlig og verifisering av anbefalte tiltak.
Kall flere uavhengige leseverktøy sammen. Les mer når metadata viser avkorting. Unngå identiske søk som allerede er besvart.
Rapportvalidering kontrollerer format og kilde-ID, ikke sannheten i påstandene: du må selv kontrollere at hver kilde støtter teksten.`;

  for (let i = 1; i <= konfig.maxIterasjoner; i++) {
    if (fristSignal.aborted) return ferdig('ufullstendig', signal.aborted ? 'Avbrutt av bruker.' : 'Samlet tidsgrense nådd.');
    if (totalTokens() >= konfig.maxTotalTokens) return ferdig('ufullstendig', 'Tokenbudsjett nådd.');
    iterasjoner = i;
    const sisteRunde = i === konfig.maxIterasjoner || lesebudsjettStengt || verktoykall >= konfig.maxVerktoykall;
    if (sisteRunde && !budsjettvarselSendt) {
      messages.push({ role: 'user', content: 'Budsjettet for nye undersøkelser er brukt opp. Lever sluttrapporten med lever_rapport alene nå, med kildene du har og tydelige kunnskapshull. Nye lesekall vil bli avvist.' });
      budsjettvarselSendt = true;
    }
    let svar;
    try {
      const forespørselSignal = AbortSignal.any([fristSignal, AbortSignal.timeout(konfig.timeoutMs)]);
      svar = await medAvbrudd(() => klient.messages.create({
        model: konfig.modell,
        max_tokens: Math.min(konfig.maxTokens, konfig.maxTotalTokens - totalTokens()),
        output_config: { effort: 'medium' },
        system: fullSystem,
        tools: definisjoner,
        tool_choice: { type: 'auto' },
        messages: structuredClone(messages),
      }, { signal: forespørselSignal }), forespørselSignal);
    } catch (e) {
      const årsak = signal.aborted ? 'Avbrutt av bruker.' : feiltekst(e);
      emit({ type: 'feil', melding: årsak });
      return ferdig('ufullstendig', årsak);
    }
    for (const navn of Object.keys(bruk)) {
      const n = svar.usage?.[navn];
      if (Number.isFinite(n) && n >= 0) bruk[navn] += n;
    }
    emit({ type: 'runde', nummer: i, stop_reason: svar.stop_reason, bruk: svar.usage ?? {} });
    if (!Array.isArray(svar.content) || !svar.content.length) return ferdig('ufullstendig', 'Modellen returnerte tomt eller ugyldig innhold.');
    messages.push({ role: 'assistant', content: svar.content });
    // Ikke eksekver et avkuttet verktøykall eller presenter det som en ferdig rapport.
    if (['max_tokens', 'model_context_window_exceeded', 'refusal', 'stop_sequence'].includes(svar.stop_reason)) {
      return ferdig('ufullstendig', `Modellen stoppet med ${svar.stop_reason}. Ingen ferdig rapport.`);
    }
    const kall = svar.content.filter(b => b.type === 'tool_use');
    if (svar.stop_reason === 'pause_turn' && !kall.length) continue;
    if (svar.stop_reason === 'end_turn' && !kall.length) {
      messages.push({ role: 'user', content: 'Lever sluttrapporten med lever_rapport. Hent manglende kilder først hvis nødvendig.' });
      continue;
    }
    if (svar.stop_reason !== 'tool_use' || !kall.length || kall.some(k => typeof k.id !== 'string' || !k.id) || new Set(kall.map(k => k.id)).size !== kall.length) {
      return ferdig('ufullstendig', 'Uventet svarprotokoll fra modellen.');
    }
    const rapportkall = kall.filter(k => k.name === rapportDefinisjon.name);
    if (rapportkall.length === 1 && kall.length === 1) {
      try {
        const rapport = validerRapport(kall[0].input, { kilder });
        emit({ type: 'rapport', melding: 'Rapportformat og kilde-ID-er er kontrollert.' });
        return ferdig('ok', null, rapport);
      } catch (e) {
        emit({ type: 'valideringsfeil', melding: e.message });
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: kall[0].id, is_error: true, content: e.message }] });
        continue;
      }
    }
    const leseKall = kall.filter(k => k.name !== rapportDefinisjon.name);
    if (verktoykall + leseKall.length > konfig.maxVerktoykall) {
      messages.push({ role: 'user', content: kall.map(k => ({ type: 'tool_result', tool_use_id: k.id, is_error: true, content: 'Verktøybudsjettet er brukt opp. Lever rapport med eksisterende kilder og oppgi begrensningen.' })) });
      lesebudsjettStengt = true;
      emit({ type: 'budsjett', melding: `Avviste ${leseKall.length} lesekall fordi gruppen ville overskride verktøybudsjettet.` });
      continue;
    }
    verktoykall += leseKall.length;
    // Samle alle verktøyresultatene fra én modellrunde, også feil, i én melding.
    const utfall = await Promise.all(kall.map(async k => {
      try {
        if (k.name === rapportDefinisjon.name) throw new Error('lever_rapport må kalles alene etter at kildene er lest.');
        const v = etterNavn.get(k.name);
        if (!v || sisteRunde) throw new Error(`Ukjent eller utilgjengelig verktøy «${k.name}».`);
        if (!k.input || typeof k.input !== 'object' || Array.isArray(k.input)) throw new Error('Verktøyinput må være et objekt.');
        const nøkkel = `${k.name}:${stabilJSON(k.input)}`;
        const cacheTreff = cache.has(nøkkel);
        // Registrer løftet før await, slik at også like kall i samme runde deler lesing.
        if (!cacheTreff) cache.set(nøkkel, medAvbrudd(() => v.kjør(k.input), fristSignal));
        let data;
        try { data = await cache.get(nøkkel); }
        catch (e) { cache.delete(nøkkel); throw e; }
        const content = JSON.stringify(data);
        if (!content || content.length > 65000) {
          cache.delete(nøkkel);
          throw new Error('For stort eller ugyldig verktøysvar. Snevre inn søket eller reduser maks.');
        }
        return { kall: k, data, cacheTreff, resultat: { type: 'tool_result', tool_use_id: k.id, content } };
      } catch (e) {
        return { kall: k, resultat: { type: 'tool_result', tool_use_id: k.id, is_error: true, content: e?.message ?? 'Verktøyet feilet.' } };
      }
    }));
    for (const u of utfall) {
      if (!u.resultat.is_error) samleKilder(u.data, kilder);
      emit({ type: 'verktoy', navn: u.kall.name, input: u.kall.input, cache: u.cacheTreff ?? false, feil: u.resultat.is_error ?? false, resultat: u.data ?? u.resultat.content });
    }
    messages.push({ role: 'user', content: utfall.map(u => u.resultat) });
  }
  return ferdig('ufullstendig', `Stoppet etter ${konfig.maxIterasjoner} modellrunder uten gyldig sluttrapport.`);
}
