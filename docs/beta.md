# Aura Harness i beta

Aura Harness samler instruktioner og værktøjer til at bygge med AI. Du kan bruge instruktionerne i dit eget kodeværktøj eller afprøve Aura-appen. Betaen er til udviklere, IT-medarbejdere og teknisk interesserede kolleger, der vil gennemgå ændringerne og give feedback.

## Det kan du afprøve

- **Instruktionspakker:** grundregler og 12 skills til 23 kodeværktøjer. Pakkerne er tekstfiler, du kan læse og tilpasse. I Claude Code og OpenCode er indlæsningen afprøvet med en kontrolleret modelserver. De øvrige værktøjer følger deres officielle dokumentation; modellernes efterlevelse er ikke certificeret.
- **Aura-appen:** opret eller åbn et lokalt projekt, tilslut din egen AI, gennemgå en plan, og arbejd videre med kode, forhåndsvisning og gemte versioner. Appen bruger Electron og en lokal OpenCode-agent.
- **Bidrag:** fejlrapporter, erfaringer, dokumentation, skills og kodeændringer. Se [bidragsvejledningen](../CONTRIBUTING.md).

## Før du installerer

[Hent Aura til Mac eller Windows](https://ai-alliancen-org.github.io/ai-harness/desktop.html). Download kræver ikke en GitHub-konto. Downloadsiden linker til udgivelsesnoterne for den konkrete version; [teststatus](teststatus.md) beskriver dens faktiske afprøvning.

Installationsfilerne findes til Mac med Apple-chip, Intel-Mac og Windows x64. Mac-pakkerne signeres med Developer ID og notariseres af Apple. Windows-betaen er usigneret. Appkode, profiler, medfølgende værktøjer og kontrolsummer kontrolleres før offentliggørelse.

Afprøvningen varierer mellem versionerne. En Windows-fil bygget og indholdskontrolleret på Mac er ikke en Windows-installationsprøve, og Rosetta erstatter ikke en Intel-Mac. Udgivelsesnoterne og teststatus angiver, hvilke konkrete installationer og opgraderinger der er kørt.

Fra 0.5.0-beta.1 udgår komplai som AI-forbindelse. komplai Run bevares til udgivelse gennem Udgiv. Det ændrer ikke indholdet af tidligere offentliggjorte installationsfiler.

Vi har enhedstests og lokale appprøver med rigtige filer og kontrollerede modelservere. Det erstatter ikke afprøvning af den aktuelle pakke med brugerens rigtige model og computer. Se [teststatus](teststatus.md) for detaljer og tidligere forsøg.

## Rammer for afprøvningen

Brug opdigtede data og et separat testprojekt. Tag en sikkerhedskopi, før du åbner et eksisterende projekt. Modeller kan lave fejl, og instruktioner er ikke teknisk adgangskontrol. Appen har endnu ikke en isoleret sandbox for hele agenten eller fælles organisationslogin.

Du vælger selv AI og hosting. De tjenester kan modtage kode og data og have egne priser og vilkår. Brug i en kommune kræver stadig kommunens vurdering af databehandling, adgang og drift. Et fungerende preview er ikke en sikkerheds- eller GDPR-godkendelse.

Fra 0.3.0-beta.1 kan appen selv søge efter opdateringer ved opstart og hver sjette time. Du vælger selv at hente opdateringen og derefter genstarte. Ældre installationer kræver en manuel opdatering én gang. Udgivelse af dine projekter afhænger af den valgte hostingtjeneste og kan kræve ekstern opsætning; betaen lover ikke et færdigafprøvet forløb hos alle udbydere.

Byggeværktøjer og medfølgende npm har tidligere registrerede afhængighedsfund. Pakningen opdaterer ikke disse afhængigheder. Se [afgrænsningen i demogennemgangen](demogennemgang.md); betaen er ikke en sikkerhedsrevideret distribution.

## Hjælp os med at afprøve

Start med et lille projekt med opdigtede oplysninger. Prøv at bygge et udkast, ændre det, lukke og genåbne projektet og gendanne en gemt version. Beskriv, hvor du blev i tvivl, og hvad du forventede skulle ske.

[Opret en fejlrapport eller et forslag](https://github.com/ai-alliancen-org/ai-harness/issues). Oplys appversion, operativsystem og de nødvendige trin. Fjern nøgler, private data og personlige filstier fra eventuelle skærmbilleder og logs. Sikkerhedsproblemer sendes [privat til kontaktpersonen](../SECURITY.md).

Kontaktperson: **Parthee Vijayamohan**, [pavi@kalundborg.dk](mailto:pavi@kalundborg.dk). Betaen har ingen garanteret support eller svartid.
