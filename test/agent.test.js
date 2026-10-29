import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as vent } from 'node:timers/promises';
import { kjørAgent, lesAgentKonfig, samleKilder } from '../src/agent.js';

const ved = '2026-10-29T03:12:00+01:00';
const kilde = { kilde_id: 'LOG-1', tid: ved, tjeneste: 'betaling', melding: 'Feil observert' };
const kall = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const svar = (content, stop_reason = 'tool_use', usage = {}) => ({ content, stop_reason, usage });
const tekst = (text, stop_reason = 'end_turn', usage) => svar([{ type: 'text', text }], stop_reason, usage);
const les = (id = 'les-1', input = {}) => kall(id, 'les_kilde', input);
const sisteVerktøyresultater = (forespørsel) => forespørsel.messages.findLast(m =>
  m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result')).content;

function rapport(id = 'LOG-1') {
  return {
    tittel: 'Undersøkt alarm', alvorlighet: 'høy', status: 'uavklart', berorte_tjenester: ['betaling'],
    fakta: [{ tekst: 'En feil er logget.', kilder: [id] }],
    hypoteser: [{ tekst: 'Mulig feil i tjenesten.', sikkerhet: 'lav', kilder: [id], motbevis: [] }],
    usikkerhet: ['Årsaken er ikke bekreftet.'],
    neste_steg: [{ tiltak: 'Undersøk feiltypen.', ansvarlig: 'Tjenestevakt', verifisering: 'Kontroller nye logger.', kilder: [id] }],
    eskalering: 'Kontakt tjenestevakten ved vedvarende feil.',
  };
}

const lever = (id = 'rapport-1', kildeId) => kall(id, 'lever_rapport', rapport(kildeId));

function verktøy(kjør = async () => ({ treff: [kilde] }), name = 'les_kilde') {
  return { definisjon: { name, description: 'Les testkilden.', input_schema: { type: 'object' } }, kjør };
}

function scenario(steg, valg = {}) {
  const forespørsler = [];
  const klient = { messages: { create: async (input, options) => {
    forespørsler.push({ input: structuredClone(input), signal: options.signal });
    assert.ok(steg.length, 'Agenten gjorde et uventet API-kall.');
    const neste = steg.shift();
    return typeof neste === 'function' ? await neste(input, options) : neste;
  } } };
  const konfig = { ...lesAgentKonfig({}), ...valg.konfig };
  return {
    forespørsler,
    kjør: () => kjørAgent({ system: 'Undersøk alarmen.', oppgave: 'Testalarm', ved,
      verktøy: [verktøy()], ...valg, konfig, klient }),
  };
}

test('grupperer vellykkede, feilede og ukjente verktøykall i én komplett resultatmelding', async () => {
  let aktive = 0;
  let maksAktive = 0;
  const samtidig = async () => {
    aktive++;
    maksAktive = Math.max(maksAktive, aktive);
    await vent(5);
    aktive--;
    return { treff: [kilde] };
  };
  const s = scenario([
    svar([les('ok'), kall('også-ok', 'annen_kilde'), kall('feil', 'feil_kilde'), kall('ukjent', 'finnes_ikke')]),
    svar([lever()]),
  ], { verktøy: [verktøy(samtidig), verktøy(samtidig, 'annen_kilde'), verktøy(async () => { throw new Error('Ugyldig filter.'); }, 'feil_kilde')] });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.equal(maksAktive, 2, 'Uavhengige leseverktøy skal kjøre samtidig.');
  const siste = s.forespørsler[1].input.messages.at(-1);
  assert.equal(siste.role, 'user');
  assert.deepEqual(siste.content.map(r => r.tool_use_id), ['ok', 'også-ok', 'feil', 'ukjent']);
  assert.equal(siste.content[0].is_error, undefined);
  assert.match(siste.content[0].content, /LOG-1/);
  assert.equal(siste.content[2].is_error, true);
  assert.match(siste.content[2].content, /Ugyldig filter/);
  assert.equal(siste.content[3].is_error, true);
  assert.equal(resultat.verktoykall, 4);
  assert.deepEqual(resultat.kilder, [kilde]);
});

test('avviser oppdiktede referanser og lar modellen reparere rapporten', async () => {
  const s = scenario([svar([les()]), svar([lever('hallusinert', 'OPPDIKTET')]), svar([lever('rettet')])]);
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.equal(resultat.iterasjoner, 3);
  assert.equal(resultat.spor.filter(e => e.type === 'valideringsfeil').length, 1);
  const feil = s.forespørsler[2].input.messages.at(-1).content;
  assert.equal(feil[0].tool_use_id, 'hallusinert');
  assert.equal(feil[0].is_error, true);
  assert.match(feil[0].content, /OPPDIKTET.*ikke hentet/);
  assert.equal(resultat.rapport.fakta[0].kilder[0], 'LOG-1');
});

test('sluttrapporten må være et eget kall etter at kilder er lest', async () => {
  const s = scenario([svar([les(), lever('for-tidlig')]), svar([lever('til-slutt')])]);
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  const resultater = s.forespørsler[1].input.messages.at(-1).content;
  assert.equal(resultater.length, 2);
  assert.equal(resultater[1].is_error, true);
  assert.match(resultater[1].content, /kalles alene/);
});

test('siste tillatte modellrunde reserveres til strukturerte rapporten', async () => {
  const s = scenario([svar([les()]), tekst('Jeg har nok informasjon.'), svar([lever()])], { konfig: { maxIterasjoner: 3 } });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  const siste = s.forespørsler[2].input;
  assert.deepEqual(siste.tools, s.forespørsler[0].input.tools);
  assert.deepEqual(siste.tool_choice, { type: 'auto' });
  assert.match(siste.messages.at(-1).content, /Budsjettet for nye undersøkelser.*Lever sluttrapporten/);
});

test('signerte tenkeblokker, system og verktøy bevares også inn i siste modellrunde', async () => {
  const signert = { type: 'thinking', thinking: 'Undersøk loggkilden.', signature: 'opaque-signature-1' };
  const skjult = { type: 'redacted_thinking', data: 'opaque-redacted-data' };
  const merTenking = { type: 'thinking', thinking: 'Sammenhold resultatene.', signature: 'opaque-signature-2' };
  const førsteInnhold = [signert, skjult, les('første')];
  const andreInnhold = [merTenking, les('andre', { tekst: 'Feil' })];
  const s = scenario([svar(førsteInnhold), svar(andreInnhold), svar([lever()])], { konfig: { maxIterasjoner: 3 } });
  assert.equal((await s.kjør()).status, 'ok');
  const første = s.forespørsler[0].input;
  for (const { input } of s.forespørsler) {
    assert.deepEqual(input.tools, første.tools);
    assert.equal(input.system, første.system);
    assert.deepEqual(input.tool_choice, { type: 'auto' });
  }
  for (const { input } of s.forespørsler.slice(1)) {
    assert.deepEqual(input.messages.find(m => m.role === 'assistant').content, førsteInnhold);
  }
  const siste = s.forespørsler[2].input;
  assert.deepEqual(siste.messages.filter(m => m.role === 'assistant')[1].content, andreInnhold);
  assert.match(siste.messages.at(-1).content, /Budsjettet for nye undersøkelser/);
  assert.equal(sisteVerktøyresultater(siste)[0].tool_use_id, 'andre');
});

test('nye lesekall blokkeres lokalt i siste runde selv om verktøyskjemaet bevares', async () => {
  let utførte = 0;
  const s = scenario([svar([les('første')]), svar([les('for-sent', { tekst: 'mer' })])], {
    verktøy: [verktøy(async () => { utførte++; return { treff: [kilde] }; })], konfig: { maxIterasjoner: 2 },
  });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.equal(utførte, 1);
  assert.deepEqual(s.forespørsler[1].input.tools, s.forespørsler[0].input.tools);
  const siste = resultat.spor.filter(e => e.type === 'verktoy').at(-1);
  assert.equal(siste.feil, true);
  assert.match(siste.resultat, /utilgjengelig/);
});

test('gjentatte ugyldige rapporter stopper ved modellrundebudsjettet', async () => {
  const s = scenario([svar([lever('a', 'OPPDIKTET')]), svar([lever('b', 'OPPDIKTET')])], { konfig: { maxIterasjoner: 2 } });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.equal(resultat.rapport, null);
  assert.equal(resultat.iterasjoner, 2);
  assert.match(resultat.årsak, /2 modellrunder/);
});

test('verktøybudsjettet stopper en for stor gruppe før noen av kallene utføres', async () => {
  let utførte = 0;
  const s = scenario([svar([les('a'), les('b')]), svar([lever('umulig')])], {
    verktøy: [verktøy(async () => { utførte++; return kilde; })],
    konfig: { maxVerktoykall: 1, maxIterasjoner: 2 },
  });
  const resultat = await s.kjør();
  assert.equal(utførte, 0);
  assert.equal(resultat.verktoykall, 0, 'Avviste grupper skal ikke telles som utførte leseforsøk.');
  assert.equal(resultat.status, 'ufullstendig');
  const neste = s.forespørsler[1].input;
  assert.deepEqual(neste.tools, s.forespørsler[0].input.tools);
  assert.deepEqual(neste.tool_choice, { type: 'auto' });
  assert.match(neste.messages.at(-1).content, /Budsjettet for nye undersøkelser/);
  assert.deepEqual(sisteVerktøyresultater(neste).map(r => [r.tool_use_id, r.is_error]), [['a', true], ['b', true]]);
});

test('brukt verktøybudsjett tillater fortsatt én gyldig sluttrapport', async () => {
  const s = scenario([svar([les()]), svar([lever()])], { konfig: { maxVerktoykall: 1 } });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  const siste = s.forespørsler[1].input;
  assert.deepEqual(siste.tools, s.forespørsler[0].input.tools);
  assert.deepEqual(siste.tool_choice, { type: 'auto' });
  assert.match(siste.messages.at(-1).content, /Budsjettet for nye undersøkelser/);
});

test('tokenbudsjettet inkluderer cache-bruk og hindrer neste API-kall', async () => {
  const usage = { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 100 };
  const s = scenario([tekst('Fortsetter snart.', 'pause_turn', usage)], { konfig: { maxTotalTokens: 300 } });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.match(resultat.årsak, /Tokenbudsjett/);
  assert.deepEqual(resultat.bruk, usage);
  assert.equal(s.forespørsler.length, 1);
  assert.equal(s.forespørsler[0].input.max_tokens, 300);
});

test('pause_turn gjenopptar samme assistentinnhold uten oppdiktede verktøyresultater', async () => {
  const pause = tekst('Arbeidet fortsetter.', 'pause_turn');
  const s = scenario([pause, svar([les()]), svar([lever()])]);
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.deepEqual(s.forespørsler[1].input.messages.at(-1), { role: 'assistant', content: pause.content });
  assert.equal(s.forespørsler[1].input.messages.length, 2);
});

for (const stop of ['max_tokens', 'model_context_window_exceeded', 'refusal', 'stop_sequence']) {
  test(`${stop} utfører ikke mulige ufullstendige verktøykall`, async () => {
    let utførte = 0;
    const s = scenario([svar([les()], stop)], { verktøy: [verktøy(async () => { utførte++; return kilde; })] });
    const resultat = await s.kjør();
    assert.equal(resultat.status, 'ufullstendig');
    assert.match(resultat.årsak, new RegExp(stop));
    assert.equal(utførte, 0);
    assert.equal(resultat.rapport, null);
  });
}

for (const [navn, content, stop] of [
  ['dupliserte kall-ID-er', [les('duplikat'), les('duplikat')], 'tool_use'],
  ['manglende kall-ID', [{ type: 'tool_use', name: 'les_kilde', input: {} }], 'tool_use'],
  ['pause med verktøykall', [les()], 'pause_turn'],
  ['ukjent stoppgrunn', [les()], 'ukjent'],
  ['tomt innhold', [], 'end_turn'],
]) {
  test(`avviser ugyldig protokoll: ${navn}`, async () => {
    let utførte = 0;
    const s = scenario([svar(content, stop)], { verktøy: [verktøy(async () => { utførte++; return kilde; })] });
    assert.equal((await s.kjør()).status, 'ufullstendig');
    assert.equal(utførte, 0);
  });
}

test('API-feil redigeres før de vises i resultat og hendelsesspor', async () => {
  for (const status of [401, 429, 500, undefined]) {
    const feil = new Error('Authorization: sk-ant-veldig-hemmelig; sensitive request body');
    feil.status = status;
    const hendelser = [];
    const s = scenario([async () => { throw feil; }], { onEvent: e => hendelser.push(e) });
    const resultat = await s.kjør();
    assert.equal(resultat.status, 'ufullstendig');
    assert.doesNotMatch(JSON.stringify([resultat, hendelser]), /sk-ant-veldig-hemmelig|sensitive request body|Authorization/);
    if (status) assert.match(resultat.årsak, new RegExp(String(status)));
  }
});

test('konfigurasjon leses ved kall etter miljøendringer', () => {
  const gammel = process.env.MAX_ITERASJONER;
  try {
    process.env.MAX_ITERASJONER = '7';
    assert.equal(lesAgentKonfig().maxIterasjoner, 7);
    process.env.MAX_ITERASJONER = '4';
    assert.equal(lesAgentKonfig().maxIterasjoner, 4);
    assert.equal(lesAgentKonfig({}).maxIterasjoner, 10);
  } finally {
    if (gammel === undefined) delete process.env.MAX_ITERASJONER;
    else process.env.MAX_ITERASJONER = gammel;
  }
  assert.throws(() => lesAgentKonfig({ MAX_ITERASJONER: '2.5' }), /MAX_ITERASJONER/);
  assert.throws(() => lesAgentKonfig({ MAX_VERKTOYKALL: '0' }), /MAX_VERKTOYKALL/);
  assert.throws(() => lesAgentKonfig({ MAX_TOTAL_TOKENS: 'NaN' }), /MAX_TOTAL_TOKENS/);
  assert.throws(() => lesAgentKonfig({ MODELL: ' ' }), /MODELL/);
});

test('et allerede avbrutt signal hindrer alle API-kall', async () => {
  const avbryter = new AbortController();
  avbryter.abort();
  const s = scenario([], { signal: avbryter.signal });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.match(resultat.årsak, /Avbrutt av bruker/);
  assert.equal(s.forespørsler.length, 0);
});

test('avbryting avslutter et API-kall selv om klienten ignorerer signalet', async () => {
  const avbryter = new AbortController();
  const s = scenario([async (_input, { signal }) => {
    assert.equal(signal.aborted, false);
    queueMicrotask(() => avbryter.abort());
    return new Promise(() => {});
  }], { signal: avbryter.signal });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.match(resultat.årsak, /Avbrutt av bruker/);
  assert.equal(s.forespørsler[0].signal.aborted, true);
});

test('avbryting under verktøykjøring hindrer neste modellrunde', async () => {
  const avbryter = new AbortController();
  const s = scenario([svar([les()])], { signal: avbryter.signal, verktøy: [verktøy(async () => {
    queueMicrotask(() => avbryter.abort());
    return new Promise(() => {});
  })] });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.match(resultat.årsak, /Avbrutt av bruker/);
  assert.equal(s.forespørsler.length, 1);
});

test('API- og samlet tidsgrense stopper en klient som ignorerer signalet', async () => {
  for (const konfig of [{ timeoutMs: 20 }, { varighetMs: 20 }]) {
    const s = scenario([async () => { await vent(80); return svar([les()]); }], { konfig });
    const resultat = await s.kjør();
    assert.equal(resultat.status, 'ufullstendig');
    assert.match(resultat.årsak, /Tidsgrensen|tidsgrense/);
    assert.equal(s.forespørsler[0].signal.aborted, true);
    assert.equal(resultat.verktoykall, 0);
  }
});

test('cache gjenbruker identiske argumenter uansett nøkkelrekkefølge', async () => {
  let utførte = 0;
  const s = scenario([
    svar([les('første', { a: 1, filter: { x: 2, y: [3, 4] } })]),
    svar([les('andre', { filter: { y: [3, 4], x: 2 }, a: 1 })]),
    svar([lever()]),
  ], { verktøy: [verktøy(async () => { utførte++; return { data: { treff: [kilde] } }; })] });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.equal(utførte, 1);
  assert.deepEqual(resultat.spor.filter(e => e.type === 'verktoy').map(e => e.cache), [false, true]);
  assert.deepEqual(resultat.kilder, [kilde]);
});

test('identiske kall i samme modellrunde deler én pågående lesing', async () => {
  let utførte = 0;
  const s = scenario([
    svar([les('første', { a: 1, b: 2 }), les('andre', { b: 2, a: 1 })]),
    svar([lever()]),
  ], { verktøy: [verktøy(async () => { utførte++; await vent(5); return { treff: [kilde] }; })] });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.equal(utførte, 1);
  const resultater = s.forespørsler[1].input.messages.at(-1).content;
  assert.deepEqual(resultater.map(r => r.tool_use_id), ['første', 'andre']);
  assert.equal(resultater[0].content, resultater[1].content);
  assert.deepEqual(resultat.spor.filter(e => e.type === 'verktoy').map(e => e.cache), [false, true]);
});

test('et verktøy som kaster null gir et feilresultat og lar undersøkelsen fortsette', async () => {
  let utførte = 0;
  const s = scenario([svar([les('feiler')]), svar([les('nytt-forsøk')]), svar([lever()])], {
    verktøy: [verktøy(async () => {
      if (++utførte === 1) throw null;
      return { treff: [kilde] };
    })],
  });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.equal(utførte, 2);
  const feil = s.forespørsler[1].input.messages.at(-1).content[0];
  assert.equal(feil.tool_use_id, 'feiler');
  assert.equal(feil.is_error, true);
  assert.equal(feil.content, 'Verktøyet feilet.');
  assert.deepEqual(resultat.kilder, [kilde]);
});

test('feilede verktøykall caches ikke og kan prøves på nytt', async () => {
  let utførte = 0;
  const s = scenario([svar([les('første')]), svar([les('andre')]), svar([lever()])], { verktøy: [verktøy(async () => {
    if (++utførte === 1) throw new Error('Midlertidig testfeil.');
    return { treff: [kilde] };
  })] });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ok');
  assert.equal(utførte, 2);
  assert.deepEqual(resultat.spor.filter(e => e.type === 'verktoy').map(e => e.feil), [true, false]);
});

test('for store verktøysvar registreres som feil uten å godkjenne kilde-ID-er', async () => {
  const s = scenario([svar([les()]), svar([lever()])], {
    verktøy: [verktøy(async () => ({ ...kilde, innhold: 'a'.repeat(65000) }))], konfig: { maxIterasjoner: 2 },
  });
  const resultat = await s.kjør();
  assert.equal(resultat.status, 'ufullstendig');
  assert.equal(resultat.kilder.length, 0);
  assert.match(sisteVerktøyresultater(s.forespørsler[1].input)[0].content, /For stort/);
});

test('kildesamling traverserer nøstede resultater og tar en uavhengig kopi', () => {
  const original = { data: [{ detaljer: { ...kilde } }] };
  const register = samleKilder(original);
  original.data[0].detaljer.melding = 'Endret etter innhenting.';
  assert.equal(register.get('LOG-1').melding, 'Feil observert');
  assert.equal(register.size, 1);
});
