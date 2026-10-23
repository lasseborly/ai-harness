# Komplai Run i andre kodeværktøjer

Kontrolleret 22. oktober 2026 mod komplais udgivelseskit, version 0.2.1, med app-SDK'ets API-beskrivelse, og komplais dokumentation om Aura-login og appadresser. Kittets CLI er MIT-licenseret og kræver Node 22.15 eller nyere. Denne reference medtager ingen af dets scripts.

Dette terminalforløb gælder kodeværktøjer uden for Aura. I Auras desktopapp bruges **Udgiv**; agentens kommandoværktøj må ikke stå for upload. Aura-terminalens `/deploy` understøtter kun Vercel og Azure Static Web Apps. Forbered Run-filerne til brugerens manuelle upload i Hub, og omgå ikke Auras godkendelser med kommandoerne her.

## Adgang til en eksisterende app

Åbn [Run i Hub](https://hub.komplai.dk/publish?guide=1), vælg appen og kontrollér dens adgang. Hub giver den præcise uploadadresse og en appnøgle. Nøglen vises én gang, gælder i syv dage og må kun uploade versioner til den app. Den kan ikke oprette apps, ændre adgang, læse private apps eller kalde AI.

Kun appens ejer og organisationens administratorer kan administrere den i Hub. Det er anderledes end Auras native adgang, som kun omfatter personens egne apps, også når personen er administrator. Auras adgang udløber efter 30 dage og må ikke kopieres til CLI'ens appnøglefelt.

Brugeren sætter `KOMPLAI_PUBLISH_TOKEN` i værktøjets private miljø eller indtaster nøglen i CLI'ens skjulte felt. CLI'en indlæser ikke automatisk en `.env`-fil. Bed aldrig brugeren sende nøglen i chatten, og vis ikke miljøets indhold i en log. En udløbet eller tilbagekaldt nøgle erstattes gennem Hub, uden at adgangskontrollen omgås.

## Kommando og gennemgang

Brug den versionsfaste kommando, Hub viser for appen. Det offentlige kit beskriver denne form; erstat uploadadressen med appens faktiske adresse fra Hub:

```sh
npx --package=https://hub.komplai.dk/komplai-publish/komplai-publish-0.2.1.tgz komplai-publish ./dist --endpoint https://hub.komplai.dk/api/publish/APP_UUID/releases --dry-run
```

`./dist` skal være den færdigbyggede mappe, ikke en antagelse om projektets mappestruktur. `--dry-run` uploader intet, kræver ingen nøgle og kontrollerer også appens `komplai.json`, som Run gør. Kontrollér de faktiske filer og deres henvisninger i browseren; et filantal eller et vellykket pakkecheck beviser ikke, at appen virker. npm-registrering af `@komplai/publish` er ikke verificeret her, så brug ikke den kortere registreringsbaserede kommando som forudsætning.

Når udgivelsen til den konkrete app er godkendt, fjernes `--dry-run`. CLI'en viser målet og spørger før upload. `--yes` må kun bruges, når denne udgivelse allerede er godkendt og projektets regler tillader den. Kommandoen kan også modtage en færdig HTML-fil eller ZIP.

Til manuel upload kan samme versionsfaste CLI bruges med `pack ./dist --out app.zip`. Det pakker kun lokalt; brugeren uploader derefter ZIP-filen i Hub. `init --endpoint …` gemmer kun uploadadresse og outputmappe i `.komplai-publish.json`, aldrig nøglen. Læs en eksisterende konfiguration før ændringer.

## Afprøv SDK-kald lokalt

Med samme pakkeadresse og `dev` i stedet for `--endpoint` serveres den færdige mappe på `http://localhost:5180`, som Run gør, med samme SDK, ruter og indholdspolitik:

```sh
npx --package=https://hub.komplai.dk/komplai-publish/komplai-publish-0.2.1.tgz komplai-publish dev ./dist
```

Kommandoen kører, til den stoppes; start den i baggrunden, og stop den efter afprøvningen. En stand-in svarer i stedet for komplai: alle erklærede brug tæller som godkendt, personen hedder Udvikler og er administrator (`--member` gør personen til almindeligt medlem), og gemte data ligger kun i hukommelsen. Hver browser kan logge ind som sin egen person på `/_komplai/dev`; et privat vindue kan være person nummer to. Redact finder kun mønstre. AI kræver en personlig API-nøgle i `KOMPLAI_API_KEY` i værktøjets private miljø; bed aldrig om den i chatten. Afvisninger skrives i terminalen. En bestået lokal prøve viser ikke, at brugen er godkendt i Run.

## Filer og grænser

- En enkelt HTML-fil skal indeholde sine egne scripts og styles. En ZIP skal indeholde hele den færdige app med `index.html` i roden; upload-API'et accepterer også én omsluttende byggemappe.
- Grænser i den kontrollerede kontrakt: 10 MiB upload, 50 MiB udpakket, 10 MiB pr. fil og 2.000 arkivposter. Højst fem versioner bevares. Organisationens aktuelle lager- og trafikrammer står i Hub og kan være anderledes end andre organisationers.
- ZIP bruger almindelig lagring eller deflate og ASCII-filstier. Skjulte stier, links, dubletter, stier uden for arkivet, `_komplai` og kildekort accepteres ikke. CLI'ens mappepakning udelader skjulte filer, afhængigheder og kildekort, men det erstatter ikke gennemgang af de resterende filer.
- Browserfiler som HTML, CSS, JavaScript, JSON, billeder, skrifttyper og mediefiler understøttes. Kildeprojekter, serverkode, containere og databaser kan ikke udgives ad denne vej. Den fulde liste over filtyper står i kittets `API.md`.
- En ny version suppleres aldrig med den gamle versions filer. Kontrollér derfor alle refererede assets i netop det indhold, der uploades, også når kun én kildefil er ændret.

## Uploadsvar og fejl

Upload-API'et modtager filens bytes med `POST /api/publish/APP_UUID/releases`, `Content-Type: application/zip` eller `text/html` og appnøglen som bearer-token. Brug CLI'en frem for at bygge et nyt uploadscript. Uploadruten afviser `Origin`-headeren og skal ikke kaldes fra browserappen. Sæt ikke en ny tilladt destination for at omgå en afvisning; kundemiljøer skal følge den udtrykkeligt aftalte adresse.

HTTP 200 indeholder appens `id` og `activeRelease`. Kontrollér, at app-id'et svarer til den valgte app. Åbn derefter dens stabile adresse fra Hub og kontrollér funktion, indlæste filer og adgang. Organisationsintern visning kræver en bruger med adgang, ikke appnøglen.

- Ved ugyldigt format eller overskredet grænse rettes den færdige pakke lokalt.
- Ved 401 eller 403 kontrolleres nøglens gyldighed, medlemskab, app og tilladelser gennem Hub.
- Ved `publication_uncertain`, netværksafbrydelse eller uventet svar: stop og kontrollér den aktive version i Hub. Upload kan være gennemført trods det tabte svar; gentag ikke automatisk.
- Ved mangel på plads, begrænset trafik eller utilgængeligt miljø: beskriv fejlen og afklar den i Hub. Opret ikke en ny app eller skift organisation som omvej.

## Kilder og afprøvningsstatus

- [komplais udgivelseskit](https://hub.komplai.dk/komplai-publish/komplai-publish.zip): `SKILL.md`, `API.md` med app-SDK'et, README og CLI 0.2.1.
- [Run og terminalvejledning i Hub](https://hub.komplai.dk/publish?guide=1).

Kilderne beskriver kontrakten. At kittet kan hentes, eller at skillen installeres korrekt, dokumenterer ikke et gennemført login, native upload eller adgangskontrol i produktion. Angiv disse som uafprøvede, indtil der er konkret evidens for det relevante miljø.
