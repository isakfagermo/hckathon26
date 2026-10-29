# Kuratert referanse for de fem alarmene

Dette er en statisk, kuratert referanse basert på oppgavens fiktive data. Den er ikke resultatet av en live modellkjøring, og dokumenterer ingen utførte driftstiltak. Demoer som bruker referansen skal merkes **kuratert referanse**. En faktisk agentkjøring må hente og vurdere sine egne kilder og vise verktøysporet.

Referansen beskriver datasettet frem til **29. oktober 2026 kl 03:48:05 +01:00**, tidspunktet for siste faktiske logglinje. Startrepoets README sier «til 03:50», men det finnes ingen logglinje fra 03:50. Det er 256 logger. En gammel måling er ikke en fersk tilstandsmåling bare fordi analysen skjer senere.

Maskinlesbare scenarier ligger i [`test/fixtures/scenarios.json`](../test/fixtures/scenarios.json). `facts` er observasjoner, `hypothesis` er tolkning, `uncertainty` synliggjør mangler, `actions` er anbefalinger og `pitfalls` beskriver feilslutninger. `status: avklart` gjelder bare den konkrete diskalarmen. `atAlarmTime` skiller hva som var kjent ved alarmen fra senere informasjon.

## Kilde-ID-er og tid

- `LOG-0001` til `LOG-0256`: én-basert original indeks i `data/logger.json`, med fire sifre. Ikke nummerer på nytt etter søk, sortering eller filtrering.
- `DEPLOY-001` til `DEPLOY-009`: én-basert original indeks i `data/deploy-historikk.json`, med tre sifre.
- `RUNBOOK-<tjeneste>` og `TJENESTE-<tjeneste>`: den aktuelle runbooken og tjenestebeskrivelsen, for eksempel `RUNBOOK-kunde-db`.
- Alarmer og hendelser bruker eksisterende `ALARM-…`- og `INC-…`-ID-er.

Ved replay på alarmtid må alle logger og deploys ha `tid <= alarm.tid`. At hendelser kommer senere i filen er ikke alene tilstrekkelig; bruk faktiske tidsstempler. En alarm kan selv oppgi en måling før en matchende detaljlogg finnes. Da skal alarmen krediteres som kilde. Historikk er sammenligningsgrunnlag, ikke bevis for at samme årsak gjelder på nytt.

## Forventet vurdering

| Alarm | Vurdering ved siste loggtid | Viktigste kilder |
| --- | --- | --- |
| `ALARM-0312`, betaling | Sterk støtte for kodefeil i 2.14.0. TypeError ved `valuta` 42 sekunder etter at versjonen kjører, fortsatt observert 03:47:42. Anbefal at vakten vurderer rollback til 2.13.2 og verifiserer bedring. | `DEPLOY-009`, `DEPLOY-002`, `LOG-0044`, `LOG-0048`, `LOG-0103`, `LOG-0254`, `RUNBOOK-betaling` |
| `ALARM-0305`, disk | Avklart: loggrotasjonen fullførte 03:09:12; 11,8 GB frigjort og /var 54 %. Ingen opprydding begrunnet av denne alarmen. | `LOG-0068`, `LOG-0082`, `LOG-0095`, `RUNBOOK-innlogging`, `INC-2026-026` |
| `ALARM-0320`, søk | Fullindeks, minnepress og GC er sterkt støttet årsak. Senere normalisering er uavklart. Hent ferske målinger og vurder pause dersom jobben fortsatt gir problemer. | `LOG-0067`, `LOG-0122`, `LOG-0123`, `LOG-0140`, `LOG-0141`, `RUNBOOK-sok`, `INC-2026-031` |
| `ALARM-0331`, SMS | Feil er dokumentert, men opprinnelig årsak er uavklart. Timeout, 429 og mer aggressiv retry kan virke sammen. Prioriter engangskoder, undersøk klienttrafikk og leverandørstatus. | `LOG-0131`, `LOG-0137`, `LOG-0155`, `LOG-0164`, `LOG-0174`, `LOG-0196`, `DEPLOY-005`, `RUNBOOK-varsling` |
| `ALARM-0340`, gateway | Sterk støtte for vedlikehold → lås på sesjoner → venting/tilkoblingsmangel → 504 via innlogging. Vekk databasevakten; kontroller aktuell blocker før operatøren vurderer avbrytelse. | `DEPLOY-003`, `LOG-0170`, `LOG-0171`, `LOG-0197`, `LOG-0199`, `LOG-0204`, `LOG-0228`, `TJENESTE-kunde-db` |

### Betaling

Utrulling 2.14.0 flytter valutakilden til `kortinfo`. Versjonen kjører på alle tre instanser kl 02:51:48 (`LOG-0044`), og første `TypeError` ved lesing av `valuta` kommer kl 02:52:30 (`LOG-0048`). Den sterke hypotesen er regresjon ved manglende kortinfo for enkelte utenlandske kort. Kodegrunnlaget for betaling finnes ikke i oppgaven, så den eksakte kodefeilen er ikke endelig verifisert.

9,4 % er målingen kl 03:12 (`LOG-0103`), ikke en løpende måling kl 03:48. Den samme feilen vedvarer i observasjoner til 03:47:42 (`LOG-0254`). En grønn `/helse` før første feil (`LOG-0045`) beviser ikke fungerende korttrekk. Én treg Kortnett-måling kl 03:26:40 (`LOG-0151`) forklarer ikke de tidligere lokale feilene. Databasevedlikeholdet begynner først kl 03:30.

Ansvarlig vakt: Sigrid Gravlund, sekundær Ola Benkvist, Team Myntkammer (`TJENESTE-betaling`). Rollback er en anbefaling til operatøren; agenten skal ikke fremstille den som utført.

### Disk på innlogging

Ved **03:05** kan agenten si at loggrotasjon er en sannsynlig forklaring, men den kan ikke allerede si at rotasjonen er fullført. `LOG-0095` kommer først **03:09:12**, og gjør deretter denne diskalarmen avklart. Det er ingen nyere diskmåling enn 54 %.

Runbookens opprydding gjelder hvis disk fortsatt er over 90 % etter 03:20. Den betingelsen er ikke dokumentert. Ikke slett arkiver eller restart innlogging på grunnlag av denne alarmen. Avklart diskalarm er heller ingen friskmelding av senere SMS- eller databasefeil.

### Søk

Fullindeks starter kl 03:00 (`LOG-0067`), etterfulgt av heap- og GC-press. Før alarmen finnes heap 92 %, GC 2,8 s og p95 4,1 s (`LOG-0122`, `LOG-0123`). **Alarmen** kl 03:20 oppgir 4,6 s og enkelte 504; den tilsvarende p95-loggen er først 03:21:34 (`LOG-0129`) og første dokumenterte søke-504 er 03:22:01 (`LOG-0130`). Ikke hent fremtidige logglinjer som belegg ved replay kl 03:20.

Siste samlede p95-måling er **5,1 s kl 03:24:16** (`LOG-0141`). Senere raske enkeltkall (`LOG-0227`, `LOG-0253`) beviser ikke at p95 er normal, og det finnes ingen fullførings- eller pauselogg for reindeksen. På den andre siden må ikke den gamle 5,1 s-målingen fremstilles som fersk. Status er derfor uavklart ved siste datatid.

Runbooken anbefaler å pause fullindeksen, kontrollere p95 under 1 s etter 2–3 minutter og la teamet planlegge neste inkrementelle kjøring. Ved en sen analyse bør operatøren først bekrefte at jobben fortsatt kjører og gir problemer. Mina Spøkelsesen er primærvakt, Arne Lyktemann sekundær; runbooken sier ingen oppvekking dersom pausen virker.

### SMS

Timeout fra 03:22:15 (`LOG-0131`), 429 fra 03:23:40 (`LOG-0137`) og klientendringen 26. oktober (`DEPLOY-005`) støtter flere forklaringer. Ekstern treghet kan utløse retries, og retries kan forsterke rate limiting. Det er ikke bevist at retry-policyen utløste feilen, ignorerer `Retry-After`, eller at SmsBud er helt nede. 429 beviser heller ikke en feilaktig sendeløkke.

Statussiden ble observert kl 03:34:20, men sist oppdatert kl 02:10 (`LOG-0196`). Den utelukker ikke leverandørfeil, og finnes ikke i kunnskapsgrunnlaget ved alarmen kl 03:31. Historisk SmsBud-avbrudd (`INC-2026-018`) etablerer heller ikke årsaken denne natten.

Køen var 1 240 kl 03:27 (`LOG-0155`) og 2 310 kl 03:35 (`LOG-0202`); siste leveringsrate er 58 % kl 03:31 (`LOG-0174`). E-post er målt normal kl 03:38 (`LOG-0219`), men ikke antatt normal til enhver tid. Engangskoder er konkret rammet (`LOG-0164`, `LOG-0218`), så Team Ugla bør prioritere dem og involvere Team Nøkkelknippe.

Runbookens leverandøreskalering gjelder ved over 30 minutters vedvarende feil. Ved alarmen har det gått **8 min 45 s** siden første observerte timeout. Ved siste loggtid 03:48:05 har det gått **25 min 50 s**. Dersom feilen vedvarer, passeres 30 minutter omkring **03:52:15**. Dette er et betinget råd, ingen opprettet timer eller utført telefonkontakt.

### Gateway og databasen

`DEPLOY-003` flyttet vedlikehold til torsdag 03:30. `LOG-0170` og `LOG-0171` bekrefter start og eksklusiv lås på `sesjoner`. Deretter kommer ventende innlogging-prosesser, stigende tilkoblingsbelegg og tilkoblingsfeil (`LOG-0175`, `LOG-0197`, `LOG-0199`, `LOG-0204`). Gatewayens 504 går hovedsakelig til `innlogging` (`LOG-0228`), som leser sesjoner i databasen.

`RUNBOOK-kunde-db` er fra **2025-11-04**. Den sier pgbouncer og søndag 04:00. `TJENESTE-kunde-db` og `INC-2026-014` dokumenterer at pgbouncer ble fjernet **12. mars 2026**, og r41 dokumenterer det nye vedlikeholdstidspunktet. Agenten må uttrykkelig identifisere denne konflikten og anbefale at runbooken oppdateres. Den skal ikke ukritisk gjenta restart av pgbouncer eller failover til replika.

Konfigurasjonen som lastes kl 03:36 (`LOG-0210`) gjelder `/api/rapport` (`DEPLOY-008`), mens de observerte feilene rammer konto/innlogging og begynner 03:33:50 (`LOG-0193`). Den er derfor ingen støttet hovedforklaring. Søke-504, den avklarte diskalarmen og intern rate limiting er heller ikke samme årsak.

Vedlikeholdet var **38 % ferdig kl 03:44** (`LOG-0244`), ikke nødvendigvis 38 % ved siste loggtid. Dette gir ikke en pålitelig sluttid. Loggene viser ventende prosess-ID-er, men identifiserer ikke sikkert blocker-PID. Be Team Grunnmur kontrollere faktisk låsholder før de vurderer kontrollert avbrytelse. Even Gravdal er primærvakt, Rune Skjelbred sekundær; involver også innlogging og gateway. En høyere gateway-timeout eller flere tilkoblinger fjerner ikke i seg selv den observerte låsen.

## Anbefalte kontroller av løsningen

1. **Kildesporbarhet:** Alle oppgitte ID-er må kunne slås opp i originaldata. Verifiser at filtre og paginering beholder opprinnelig ID.
2. **Tidsavgrensning:** Replay kl 03:05 må ikke bruke fullført rotasjon kl 03:09. Replay kl 03:20 må ikke bruke detaljlogger kl 03:21–03:24. Replay kl 03:31 må ikke bruke status, kø eller e-postmålinger som kommer senere.
3. **Kildetype og alder:** 4,6 s kl 03:20 kan siteres fra alarmen; 5,1 s er målt kl 03:24:16. Rate 9,4 %, 58 % og 17,2 % må alltid ha riktig måletid. 256 logger slutter kl 03:48:05.
4. **Motstrid:** Gatewayanalysen må oppdage gammel database-runbook og dagens direkte tilkoblinger. Ingen anbefaling om blind pgbouncer-restart eller failover skal stå uimotsagt.
5. **Usikkerhet:** SMS-svaret skal holde både eksternt problem og egen retry-forsterkning åpne. Søk skal ikke friskmeldes fra enkelte raske kall. Fravær av en logglinje er ikke bevis for at en hendelse aldri har skjedd.
6. **Årsak og symptom:** Skill betalingsregresjon, diskrotasjon, fullindeks, SMS-feil og databaselås. Flere samtidige hendelser skal ikke samles under én årsak uten belegg.
7. **Tiltak og eierskap:** Alle tiltak må være anbefalinger med ansvarlig team og kontroll av effekt. Ingen påstand om utført rollback, pause, databaseinngrep, sendt melding eller vekket vakt.
8. **Demoens ærlighet:** Et statisk scenario er en kuratert referanse og skal merkes slik. Modellkvalitet kan ikke hevdes testet bare fordi et ferdigskrevet scenario vises korrekt.
