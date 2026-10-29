# Verifisering av leveransen

Utgangspunkt: `halloween-hackaton-2026/natteskiftet`, commit `e9f55b7`.

Kontrollert lokalt 29. oktober 2026:

- `npm ci --ignore-scripts` med npm 10.5.0: bestått; åtte pakker installert fra `package-lock.json`.
- Node 20.12.2: **112 av 112 tester bestått**, ingen hoppet over.
- Node 24.22.1: **112 av 112 tester bestått**, ingen hoppet over.
- `npm run eval`: **22 av 22 kuraterte scenariotester bestått** (disse inngår også i de 112).
- Demo for alle fem alarmer: validert rapport, faktiske kildeoppslag og verktøyspor, ingen modellkall.
- `@anthropic-ai/sdk` 1.1.0: to modellrunder gjennom SDK-ens HTTP-adapter med simulerte svar, ekte verktøy og validert gatewayrapport. Ingen forespørsel ble sendt over nettverket.
- Ekte Anthropic API med `claude-sonnet-5-5`: alle fem alarmanalyser fullført etter justering av systeminstruksjonene. Samme standardbudsjetter som før; ingen API-feil. Se [detaljer og manuell innholdsvurdering](live-test.md).
- Node 24.22.1 etter siste promptendring: **112 av 112 tester bestått**.
- `git diff --check`: ingen whitespace-feil.

Testene omfatter tidsavgrensning, alle seks dataverktøy, kilde-ID-er, rapportformat, modellprotokoll, bevaring av signerte innholdsblokker, budsjetter, tidsfrister, avbrudd, cache, CLI og eksport.

**Grense for verifiseringen:** Fem fullførte API-analyser bekrefter at integrasjonen fungerer i denne kjøringen. Strukturell godkjenning og gyldige kilde-ID-er garanterer ikke riktige påstander. Manuell kontroll fant gjenværende unøyaktigheter, beskrevet i testnotatet. De kuraterte analysene og de simulerte modellsvarene beviser heller ikke kvaliteten på levende modellresonnement. GitHub Actions-konfigurasjonen er lagt ved, men er ikke kjørt på GitHub som del av denne leveransen.

Koden og dokumentasjonen er levert lokalt. Ingen produksjonshandlinger, varsler eller GitHub-publisering er utført.
