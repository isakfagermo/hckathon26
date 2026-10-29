# Ekte API-test – 29. oktober 2026

**Alle fem alarmanalyser fullførte med strukturelt gyldige rapporter og innhentede kilde-ID-er.** Ingen autentiserings-, nettverks- eller API-feil i den siste gjennomkjøringen. Dette bekrefter fungerende modellintegrasjon, ikke feilfrie analyser.

Modell: claude-sonnet-5-5. SDK: @anthropic-ai/sdk 1.1.0. Node: 24.22.1. Kildegrunnlag: oppgavens fiktive data frem til 2026-10-29 kl. 03:48:05 +01:00. Testen kalte den virkelige agentløkken med ekte leseverktøy og Anthropic Messages API. Standardbudsjettene var uendret: 10 runder, 40 lesekall, 6000 output-tokens per kall, 80000 registrerte tokens før nye kall stoppes og 180 sekunder per analyse.

## Resultater fra siste gjennomkjøring

| Alarm | Teknisk resultat | Runder | Lesekall | Input-tokens | Output-tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| ALARM-0312 | ok | 4 | 6 | 45707 | 5472 |
| ALARM-0305 | ok | 2 | 5 | 18091 | 2178 |
| ALARM-0320 | ok | 3 | 9 | 36647 | 3424 |
| ALARM-0331 | ok | 4 | 7 | 50035 | 6242 |
| ALARM-0340 | ok | 4 | 8 | 62401 | 6318 |

Totalt 236515 registrerte tokens i siste gjennomkjøring. Tre rapporter fikk ett ekstra forsøk etter ukjente skjemafelt; modellen rettet alle tre. Ingen av disse feilaktige utkastene ble godkjent som sluttrapport.

## Hva testen avdekket og hva som ble endret

Første forsøk fullførte betaling, disk og søk. Agenten undersøkte for mange uavhengige hendelser, diskrapporten fikk feil samlet status/alvorlighet, og SMS-analysen ble avkuttet under rapportreparasjon. Gateway ble derfor ikke forsøkt i første batch.

Systeminstruksjonene ble deretter strammet inn: én alarm per rapport, bevar alvorlighet uten eksplisitt begrunnelse, kortere rapporter, målbare observasjoner med tidsangivelse og tydelig skille mellom enkeltkall og aggregert tilstand. Ingen fasitsvar ble lagt inn. Alle 112 lokale tester besto etter endringen. En ny full gjennomkjøring ga resultatene over.

Første forsøk brukte 311722 registrerte tokens; samlet for begge forsøk 548237. Dette er API-rapportert tokenbruk, ikke et beløp eller en garanti for endelig fakturering.

## Manuell innholdsvurdering

- **Betaling:** Finner regresjonen etter 2.14.0, skiller lokal TypeError fra treg Kortnett-måling, beholder kritisk alvorlighet og anbefaler menneskelig vurdering av rollback.
- **Disk:** Knytter alarmen til loggrotasjon og korrekt avklaring kl. 03:09:12. Ingen natteeskalering for disk. Enkelte formuleringer omtaler 54 % som nåtilstand, selv om usikkerhetsdelen korrekt sier at nyere målinger mangler.
- **Søk:** Finner fullindeks, heap-press og GC. Beholder uavklart status og sier eksplisitt at raske enkeltkall ikke beviser normal p95. Forslaget om heap under 86 % er avledet fra første advarsel, ikke en dokumentert friskmeldingsgrense.
- **SMS:** Beholder usikkerhet om leverandørfeil og intern retry-forsterkning, og oppdager den utdaterte grønne statussiden. Eskaleringen er for upresis: ved datagrensen 03:48:05 har det gått 25 minutter og 50 sekunder siden første timeout 03:22:15. Runbookens «over 30 min» nås først etter ca. 03:52:15 dersom feilen vedvarer. Rapporten bør ikke leses som at denne terskelen allerede er nådd. Påstanden om fungerende push er heller ikke dokumentert av de oppgitte kildene.
- **Gateway:** Finner kjeden cron-endring → VACUUM FULL/lås → tilkoblingspress → innlogging → 504 og avviser pgbouncer-rådet i gammel runbook. En sidebemerkning sier at betalingsfeilen startet 03:25; det er første treff i søket fra 03:25, mens datasettets første TypeError er 02:52:30. Hoveddiagnosen påvirkes ikke, men påstanden viser en gjenværende svakhet ved filtrerte søk. Ved eventuelt inngrep må databasevakten først bekrefte faktisk blokkerende prosess og fersk tilstand.

Originale modellsvar er bevart uendret. Dette notatet korrigerer dem eksplisitt; det erstatter dem ikke med kuraterte svar. Format- og kildekontrollen validerer ikke semantisk belegg. Rapportene er beslutningsstøtte som må leses mot kildene.

## Reproduserbarhet og leveranse

Kjør fra prosjektmappen med egen nøkkel i miljøet: `npm start -- --alle --json --stille > ny-kjoring.json`. En slik kjøring sender data til Anthropic og medfører API-forbruk. Modellresultatene kan variere. Testene her gjelder siste datagrense, ikke en ekte API-test av alle historiske `--ved`-valg.

I leveransemappen finnes `live-test-v2/ALARM-*.md` og `.json` med originale rapporter, kildevedlegg og verktøyspor, samt `live-test-v2/resultater.json`. Første forsøk er bevart separat under `live-test/`. `live-api-rapporter.md` samler de fem siste rapportene og dette notatet.

Nøkkelen ble gitt via standard input til testprosessen og ble ikke skrevet til prosjektfiler eller rapporter. Alle dataverktøy er skrivebeskyttet. Ingen produksjonstiltak, meldinger til andre eller GitHub-push ble utført.
