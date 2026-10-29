import fs from 'node:fs';
import { samleKilder } from './agent.js';
import { validerRapport } from './rapport.js';

// Håndskrevne referanseanalyser. Dette er bevisst ingen simulert «AI-klient».
export const scenarier = JSON.parse(fs.readFileSync(new URL('../test/fixtures/scenarios.json', import.meta.url), 'utf8'));

export async function kjørDemo({ alarmId, verktøy, ved, onEvent = () => {} }) {
  const scenario = scenarier.find(s => s.alarmId === alarmId);
  if (!scenario) throw new Error(`Ingen referansedemo for ${alarmId}.`);
  if (Date.parse(ved) !== Date.parse(scenario.asOf)) throw new Error('Referansedemoen gjelder bare siste observasjonstidspunkt. Bruk modellmodus for --ved.');
  const kilder = new Map();
  const spor = [];
  const etterNavn = new Map(verktøy.map(v => [v.definisjon.name, v]));
  const kildebehov = [...new Set([
    ...scenario.requiredEvidence,
    ...scenario.facts.flatMap(f => f.evidence),
    ...scenario.hypothesis.evidence,
    ...scenario.actions.flatMap(a => a.evidence),
    ...scenario.owners.flatMap(o => o.evidence),
    ...scenario.pitfalls.flatMap(p => p.evidence),
  ])];
  const plan = [
    ['hent_alarmer', {}],
    ['hent_tjenesteinfo', {}],
    ['sjekk_deploy_historikk', {}],
    ['finn_lignende_hendelser', {}],
    ['sok_i_logger', { maks: 200 }],
    ...kildebehov.filter(id => id.startsWith('RUNBOOK-')).map(id => ['hent_runbook', { tjeneste: id.slice(8) }]),
  ];
  for (const [navn, input] of plan) {
    const resultat = await etterNavn.get(navn).kjør(input);
    if (navn === 'sok_i_logger' && resultat.metadata.neste_offset !== null) {
      plan.push([navn, { ...input, offset: resultat.metadata.neste_offset }]);
    }
    samleKilder(resultat, kilder);
    const event = { type: 'verktoy', navn, input, feil: false, resultat };
    spor.push(event);
    onEvent(event);
  }
  for (const id of kildebehov) {
    if (!kilder.has(id)) throw new Error(`Referansedemoen mangler kilde ${id}. Oppdater demoens leseplan.`);
  }
  const rapport = validerRapport({
    tittel: scenario.title,
    alvorlighet: scenario.severity,
    status: scenario.status,
    berorte_tjenester: scenario.affectedServices,
    fakta: scenario.facts.map(f => ({ tekst: f.text, kilder: f.evidence })),
    hypoteser: [{
      tekst: scenario.hypothesis.text,
      sikkerhet: scenario.hypothesis.confidence,
      kilder: scenario.hypothesis.evidence,
      motbevis: scenario.pitfalls.map(p => `${p.claim}: ${p.assessment}`),
    }],
    usikkerhet: scenario.uncertainty,
    neste_steg: scenario.actions.map(a => ({ tiltak: a.recommendation, ansvarlig: a.owner, verifisering: a.verification, kilder: a.evidence })),
    eskalering: scenario.escalation,
  }, { kilder });
  return {
    status: 'ok', årsak: null, rapport, ved,
    modus: 'referansedemo – kuratert analyse, ingen modell kjørt',
    alarmId, modell: null, iterasjoner: 0, verktoykall: spor.length,
    bruk: { input_tokens: 0, output_tokens: 0 },
    kilder: [...kilder.values()], spor,
  };
}
