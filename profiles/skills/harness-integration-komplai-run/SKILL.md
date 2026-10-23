---
name: harness-integration-komplai-run
description: Bygger og forbereder browserapps til komplai Run, også apps der bruger komplais app-SDK til login, AI, Redact, gemte data og hændelseslog, og vejleder om udgivelse, godkendelse og kontrol af den udgivne version. Brug den, når brugeren har valgt Run til en ny app eller vil opdatere en app der. Skelner mellem Auras desktopapp, Aura-terminalen og andre kodeværktøjer.
---

# komplai Run

Run viser færdige browserapps på adresser som `budget.komplai.run`. Brug denne skill, når brugeren har valgt Run. Den opretter ikke i sig selv adgang, godkender ikke appens brug af komplai og giver ikke tilladelse til at udgive.

## Forbered appen

- Læs projektets eksisterende byggeopsætning. Byg React, Vite eller andre frameworks lokalt, og find den faktiske outputmappe med `index.html`. Upload ikke kildeprojektet.
- Lever enten én HTML-fil med alt indhold indlejret eller en ZIP med `index.html` og alle nødvendige billeder, skrifttyper, CSS- og JavaScript-filer. Hver udgivelse erstatter hele versionen; filer fra den forrige version følger ikke med.
- Brug relative filadresser eller stier fra appens egen rod. Kontrollér den færdige outputmappe i en browser, herunder navigation, indlæste filer og eksterne kald.
- Run kører ingen serverkode. Login, AI, Redact, gemte data og hændelseslog fås kun gennem komplais app-SDK, beskrevet nedenfor. Der er ingen cron, funktioner eller filupload. Browserens lokale lager er hverken fælles data eller en sikkerhedskopi.
- Hold `.env`, nøgler, private data, kildekort og `node_modules` ude af udgivelsen. En browserapp kan ikke holde en API-nøgle hemmelig, heller ikke bag login.

## Brug komplai fra appen

- Indlæs SDK'et med `<script src="/_komplai/run/v1.js"></script>` i `<head>`. Det definerer `komplai`. Som modul bruges `import { komplai } from "/_komplai/run/v1.mjs"`. Run serverer filen fra appens egen adresse; læg den ikke i projektet. Stier under `/_komplai` afvises ved upload.
- Erklær hver brug i `komplai.json` ved siden af `index.html` (med Vite i `public/`) eller i `<script type="application/komplai+json">` i `index.html`'s `<head>`. Manifestet serveres med appen og må ikke indeholde noget hemmeligt. Giv hver brug en `reason` på brugerens sprog, så administratoren kan se, hvorfor appen har brug for den. Bed kun om det, appen bruger.
- Brugene er `identity` med de felter, appen viser, `ai.chat` med behandlingen `eu-cloud` eller `connection`, `redact.text`, `data` med navngivne samlinger og `log` med hændelser, fejlrapporter og anonyme tællinger. Felter, grænser og fejlkoder står i komplais API-beskrivelse under kilderne.
- En administrator godkender hver brug på appens side i Run under **Det må appen**. En ny version, der beder om mere, venter på en ny godkendelse; resten virker imens. Beskriv ikke en funktion som virkende, før den er afprøvet i Run efter godkendelsen.
- Identitet, AI, Redact, gemte data og hændelser virker kun i apps, der er for organisationen. En offentlig app må kun bruge anonyme tællinger ud over tema, sprog og appens egne oplysninger.
- Kald aldrig Hub eller komplais API direkte fra appen, og læg aldrig en nøgle, et token eller en adgangskode i appen. Alle kald går gennem SDK'et til appens egen adresse.
- Vis hver afvisning: en `KomplaiError` har `code` og `message` på personens sprog; vis beskeden. `capability_not_approved` betyder, at brugen endnu ikke er godkendt. Skift aldrig til en anden behandling, samling eller tjeneste efter en fejl.
- Skriv data fra komplai ind på siden med `textContent` eller frameworkets tekstbinding, aldrig `innerHTML`.
- Gemte data: Brug `scope: "app"` til det, appens brugere deler, og `organisation` kun til en samling, flere apps deler. Et medlem ændrer kun de dokumenter, medlemmet selv har oprettet. Brug `{ ifVersion: doc.version }`, når en opdatering ikke må overskrive andres ændringer, og håndtér `version_conflict`. Et medlems id navngiver ingen; gem navnet fra `komplai.me()` i dokumentet, hvis appen viser, hvem der skrev det. Overvej `retainDays` for persondata.

## I Auras desktopapp

Brugeren udgiver gennem **Udgiv** og komplai-login. Er udgivelse slået fra, kan brugeren slå den til med **Udgiv → Slå udgivelse til** eller under **Indstillinger → Funktioner**.

Agentens kommandoværktøj må ikke publicere. Brug hverken CLI, direkte API-kald eller en anden vej som omgåelse af Udgiv. Forbered filerne og forklar det næste trin i appen; bed ikke om en udgivelsesnøgle i samtalen.

Aura bruger en særskilt udgivelsesadgang, der gælder i 30 dage for personens egne apps i den valgte organisation. Lad brugeren vælge app i Udgiv og gennemgå filerne før upload. Ved en ny app vælges adresse og adgang uden forvalg; en offentlig app bekræftes med appens navn. En app, der bruger identitet, AI, Redact eller gemte data, skal være for organisationen. En eksisterende app beholder sin adgang; ændringer af adgang, godkendelser, tilbagerulning, afpublicering og sletning håndteres i Run.

Run modtager kun færdige filer. Har appen et byggetrin, fx React med Vite, bruger Udgiv en gemt byggemappe (`dist`, `build` eller `out` med `index.html`). Findes den ikke, tilbyder Udgiv at bygge appen på brugerens computer i en midlertidig kopi af den gemte version efter brugerens ja: `npm ci` eller `npm install` uden pakkernes installationsscripts og derefter `npm run build`. komplai bygger intet. Projektet skal bruge npm og have et `build`-script, der skriver til en af de tre mapper. Byggemappen må gerne stå i `.gitignore`. Kør ikke selv upload; forklar brugeren, at Udgiv bygger. Kan bygningen ikke gennemføres, kan brugeren vælge en mappe med færdige filer i stedet.

Når komplai Run-integrationen er slået til, svarer Auras forhåndsvisning appens SDK-kald gennem komplai med brugerens rigtige identitet og AI, mens data fra forhåndsvisningen holdes adskilt fra appens rigtige data. Første gang logger brugeren ind med komplai under **Udgiv** og opretter appen fra forhåndsvisningen; den er kun for organisationen. Brugene i projektets `komplai.json` gælder kun forhåndsvisningen. Efter udgivelse skal en administrator godkende dem under **Det må appen**, før de virker i Run; fortæl brugeren det.

## I Aura-terminalen

`/deploy` understøtter Vercel og Azure Static Web Apps, ikke komplai Run. Forbered filerne og henvis brugeren til manuel upload i Run. Omgå ikke Auras udgivelsesforløb eller godkendelser med CLI eller direkte API-kald fra agentens kommandoværktøj.

## I andre kodeværktøjer

Læs [references/run.md](references/run.md) for terminalforløbet, afprøvning med `komplai-publish dev`, uploadformatet og fejlhåndtering. Brug den versionsfaste kommando fra appens side i Run. Antag ikke, at pakken findes i npm-registret.

Terminalforløbet bruger en nøgle til én eksisterende app, som udløber efter syv dage. Brugeren sætter den i værktøjets private miljø eller CLI'ens skjulte nøglefelt. Læg den aldrig i chat, kommandoargumenter, projektfiler, versionshistorik eller logs. Udgiv kun, når brugeren har godkendt målappen, filerne og adgangen; en eksisterende godkendelse af samme handling skal ikke indhentes igen. Følg fortsat projektets regler for udgivelse og CI/CD.

## Adgang og resultat

En offentlig app udleverer HTML og alle medsendte filer til enhver, også uden at have fået linket. En organisationsintern app kræver komplai-login; en udgivelsesnøgle giver ikke læseadgang. Kontrollér den konkrete organisations aftale og rammer, hvis omkostninger, AI-forbrug eller databehandling er uafklaret. Lov ikke gratis drift eller en bestemt behandlingsregion ud fra produktnavnet.

Efter upload: åbn den faktiske appadresse, afprøv den vigtigste handling og kontrollér den valgte adgang. Ved afbrudt forbindelse eller ukendt udfald skal den aktive version kontrolleres i Run før et nyt forsøg. Gentag ikke automatisk.

Rapportér den observerede version og de kontroller, der faktisk er gennemført. En lokal prøve, et godkendt upload, en godkendt brug og en afprøvet app på dens rigtige adresse er forskellige resultater.
