# Inviteret test af Aura

Formålet er at se, om en person uden udviklererfaring selv kan bygge, ændre og genfinde en lille app. Brug kun opdigtede oplysninger. En test af brugerfladen er ikke en godkendelse til at behandle kommunale personoplysninger.

Det korte materiale, der kan sendes til testpersonerne, står i [Demo til testere](demo-til-testere.md). Vedligeholderens samlede UI/UX-vurdering og udsendelsesgrænser står i [demogennemgangen](demogennemgang.md). Første brugerobservation gennemføres under piloten; den skal ikke allerede være bestået for at invitere den første person. Model, downloadadgang og den konkrete installation skal derimod være afprøvet først.

## Før invitationen sendes

Vedligeholderen udfylder disse oplysninger for **den konkrete installationsfil**, ikke blot for kildekoden:

- Appversion, filnavn og SHA-256.
- Downloadlink, som testeren faktisk har adgang til. Repositoryet er privat; et GitHub-link kræver invitation og login.
- Afprøvet styresystem og arkitektur. En Windows-pakke bygget på en Mac er ikke en Windows-test.
- Mac-signatur og Apple-notarisation, eller den præcise begrænsning. Windows-signering angives særskilt.
- En navngiven model og udbyder, som har gennemført idé, plan, bygning og en efterfølgende ændring. Gratis adgang kan være begrænset af kapacitet og kvoter.
- Kontaktpersonen, som tager imod feedback. Brugeren behøver ikke oprette en GitHub-issue.

Udfyld først invitationen, når download og den aftalte model er afprøvet. Der er ingen grund til at bede en tester gætte endpoint, modelnavn eller arkitektur.

## Forslag til invitation

> Du er inviteret til at prøve Aura. Appen hjælper dig med at bygge en lille applikation ved at beskrive, hvad du vil have.
>
> Hent **[version og filnavn]** her: **[privat downloadlink]**. Den er afprøvet på **[system og arkitektur]**. **[Oplysning om signering/notarisation]**.
>
> Vi bruger **[model og forbindelse]**. **[Præcis adgangsvej: allerede startet Ollama eller API-nøgle indtastet i appen]**. Du skal ikke bruge GitHub eller en terminal for at bygge lokalt. Følg din arbejdsplads’ regler for installation og AI-adgang.
>
> Prøv fx: “Jeg vil lave en oversigt over tre fiktive mødelokaler, hvor jeg kan finde et lokale med plads til mit møde.” Brug opdigtede oplysninger, også når du afprøver resultatet.
>
> Send dine oplevelser til **[kontaktperson og kontaktvej]**. Fortæl, hvor du gik i stå, eller hvad du savnede. Appversion og en valgfri fejlrapport findes under Indstillinger → Hjælp og feedback. Send ikke API-nøgler eller arbejdspladsens data.

## Det testeren skal prøve

1. Installer og åbn appen uden terminalkommandoer. Gå gennem introduktionen, og forbind den aftalte AI via adgangsnøgle eller AI på computeren. Prøv også Tilbage og Vælg senere. Når appen spørger "Hvad skal Aura hjælpe med?", så forklar med dine egne ord forskellen på Hele pakken og Vælg selv, før du vælger. Noter, om hvert trin er forståeligt uden forklaring.
2. Beskriv din idé med egne ord, og opret projektet. Har du ingen idé, så brug et af eksemplerne under feltet, og ret det til. Mangler du en forklaring undervejs, så åbn en ⓘ, og sig, om den hjalp. Find bagefter projektmappen under Dokumenter › Aura. Forklar med dine egne ord, hvad appen vil sende til modellen, når resuméet **Før du sender** vises.
3. Svar på AI’ens spørgsmål ved at klikke på et svar, og prøv én gang Skriv dit eget svar. Åbn fanen Plan, og forklar med dine egne ord, hvad briefen er, og hvor linjerne kommer fra. Ret én linje i briefen. Læs AI’ens forslag, ret én ting i planen selv, og bed AI’en om en anden ændring. Byg derefter første udkast. Når AI’en spørger, om den må ændre filer, så forklar forskellen på **Tillad for denne opgave** og **Kun denne fil**, før du vælger.
4. Prøv appen i preview på computer- og mobilbredde. Bed AI’en rette én konkret ting, og kontroller resultatet. Skriv noget i et felt i previewet, skift til Ændringer, og forklar med dine egne ord, hvilke filer AI’en ændrede, og hvad de røde og grønne linjer betyder. Gå tilbage til Forhåndsvisning, og se, om det, du skrev, stadig står der. Åbn en fil, AI’en nævner i samtalen, og find den under Kode. Slå **Ret i siden** til, ret en overskrift, og fortryd rettelsen. Vælg derefter et andet element, og bed AI’en ændre netop det. Forklar med dine egne ord, hvad AI’en fik at vide om elementet, og hvor du kunne se det, før du sendte.
5. Efter en AI-opgave: ret selv en lille ting i siden med Ret i siden, og brug derefter Fortryd opgaven på resultatkortet. Forklar ud fra gennemgangen, hvad der sker med din rettelse, og kontroller bagefter forhåndsvisningen. Åbn Versioner i projektmenuen, find AI'ens version ud fra billederne, giv den et navn, du kan genkende, og gå tilbage til den med Gå tilbage hertil. Lav en lille ændring selv, og gem den med Gem version. Forklar med dine egne ord, hvad en version er.
6. Skriv en kladde, og luk Aura. Åbn appen igen: projektet skal åbne af sig selv. Find kladden, samtalen, filerne og forbruget under skrivefeltet. Start en ny samtale med +, og bed AI’en om noget andet. Skift tilbage til den første samtale i sidepanelet, mens AI’en arbejder, og forklar, hvad markeringerne ved samtalerne betyder. Omdøb en samtale. Tryk ⌘K, og find en samtale eller en handling ved at skrive et ord.

   Start også en anden opgave, mens den første arbejder. Forklar, hvilken samtale der bruger projektet, og hvilken der bruger en kopi. Prøv begge previews, og stop kun den ene opgave. Når begge er afsluttet, vælg **Flet ind i projektet**, og forklar gennemgangen før bekræftelse. Ret selv en af de samme linjer i projektet, og prøv igen med en ny kopi: vælg, hvad der skal gælde ved konflikten. Fortryd indfletningen gennem Versioner. Luk med en uflettet kopi, og genfind den efter genstart.
7. Åbn Indstillinger › Funktioner. Slå én funktion fra kun for dette projekt, og find ud af, hvad der er forsvundet i appen. Slå den til igen med Brug standarden. Forklar, hvad "Altid slået til" betyder for dig.
8. Når AI’en beder om lov til noget, så forklar med dine egne ord, hvad den vil gøre, og hvorfor. Afvis én gang med en besked, og se, om AI’en følger den. Stop derefter en AI-opgave. Beskriv ud fra resultatkortet, hvad du tror er gemt, og hvordan du vil fortsætte. Læs Kontroller på et resultatkort, og forklar, hvad Aura har kontrolleret, og hvad den ikke har. Find Hjælp og feedback, og se fejlrapporten før eventuel deling.
9. Installer den næste testversion oven på den første, og åbn samme projekt. Kontroller filer, kladde, gemt designpakke og forbindelsesvalg. En nøgle kan kræve ny indtastning; nulstil aldrig systemets nøglering.
10. Vælg **Aura Harness i dit kodeværktøj** i sidepanelet. Læs under **Det følger med**, hvad to af skillsene gør, og forklar dem med dine egne ord. Installer Aura Harness i en kopi af et projekt til det kodeværktøj, du bruger. Gennemgå ændringerne, åbn projektet i værktøjet, og spørg efter kontrolordet. Fjern derefter installationen igen, og kontroller, at dine egne filer er uændrede.

Test af React/Vite eller Astro omfatter også gennemgang af installation, start, mobilvisning, stop og genstart af preview. Apps med native platformskrav skal vurderes særskilt; denne test beviser ikke iOS-, Android- eller appbutiksunderstøttelse.

## Milepæl 7: observation af det samlede forløb

**Status: ikke gennemført med en testperson.** Guiden nedenfor er klar; automatiske Electron-prøver tæller ikke som en brugerobservation. Brug den aftalte AI-forbindelse og noter den konkrete model. En kontrolleret testmodel kan bruges til at undersøge betjeningen, men så vurderes modellens kvalitet ikke.

Observatøren klargør installation og adgang efter afsnittet ovenfor. Brug et nyt projekt og opdigtede data. Optag kun skærm eller lyd efter testpersonens accept. Registrer ingen nøgler, rigtige personoplysninger eller fulde samtaler med arbejdsdata. Noter hjælp med det samme; fuldførelse efter vejledning tæller som gennemført **med hjælp**.

Giv testpersonen disse opgaver én ad gangen, uden at nævne knapper:

1. “Lav en lille oversigt over tre fiktive mødelokaler, hvor man kan finde et lokale med plads til sit møde.” Lad personen vælge eller formulere idéen, læse Før du sender og gennemgå planen. Spørg: “Hvad tror du bliver sendt, og hvem får det?”
2. “Få første udkast bygget, og prøv at bruge det.” Observer godkendelsen og previewet. Spørg: “Hvad har Aura kontrolleret, og hvad vil du selv prøve?” Noter om siden faktisk løser opgaven; en vist side er ikke tilstrækkeligt.
3. “Ret overskriften til dit eget navn for oversigten. Se bagefter, hvad du ændrede, og sæt rettelsen tilbage.” Observer valg af element, tekstrettelse, Ændringer og Fortryd. Kontroller både fil og preview bagefter; gem ingen fuldførelse, hvis kun knappen blev fundet.
4. “Bed AI’en om én ændring. Fortryd derefter AI’ens opgave, men behold en anden rettelse, du selv laver.” Personen skal forklare gendannelsens gennemgang før bekræftelse. Observer, om ændringer og brugerens rettelse faktisk får det beskrevne resultat.
5. “Find den version, du vil lade en anden prøve, og gennemgå, hvordan den kan deles.” Stop før upload, hvis en rigtig testdestination og tilladelse ikke er klargjort. Spørg: “Hvilken version deler du, hvor lander den, og hvem kan åbne den?” Lad personen skelne GitHub-sikkerhedskopi fra et testlink. En uflettet kopi må ikke opfattes som det, der udgives.
6. Hvis et godkendt testlink allerede findes: lad testpersonen åbne det med **sin egen adgang**, prøve appens vigtigste funktion og forklare kontrollerne. Et HTTP-svar uden login er ikke testpersonens adgangsprøve. Noter kontotype, hvilken rute der blev åbnet, og om funktionen virkede; skriv ikke loginoplysninger. Uden et testlink registreres dette trin som **ikke afprøvet**.

Ved 980 × 720 og større tekst: lad personen finde og betjene gennemgang, bekræftelse og Luk med tastatur. Slå reduceret bevægelse til. Noter skjult tekst, uventet fokusflytning og hjælp, der blev nødvendig. En særskilt test med skærmlæser registreres særskilt.

### Observationsnotat, der udfyldes efter testen

Kopiér dette afsnit til et dateret notat. Ingen felter er evidens, før de er udfyldt efter en faktisk observation.

- Dato, observatør og anonymt deltager-ID:
- Deltagerens udviklererfaring og eventuel erfaring med AI:
- Appversion / commit, installationsfil og SHA-256, system og arkitektur:
- Model, udbyder og forbindelse: rigtig model / kontrollerede svar:
- For hvert trin 1–6: **uden hjælp / med hjælp / ikke gennemført / ikke afprøvet**:
- Deltagerens forventning og egne ord om version, destination og adgang:
- Konkret handling, resultat i fil og preview, eventuel hjælp og næste forsøg:
- Tastatur, størrelse, zoom, reduceret bevægelse og eventuel skærmlæser:
- Testlink, udgivelsesversion og observeret adgang/funktion, eller hvorfor trin 6 ikke blev prøvet:
- Fund, der skal rettes, og gentagelse efter rettelsen:

Der kan først stå “observeret med en person uden udviklererfaring”, når notatet findes. Invitation og deling af en installation kræver desuden de konkrete pakke- og adgangsprøver i begyndelsen af dokumentet. Ingen samlet “færdig”-status følger alene af grønne automatiske prøver.

## Til den, der observerer

Bed testeren tænke højt. Start med opgaven, og undlad at fortælle, hvilken knap der skal trykkes på. Noter konkrete handlinger og formuleringer. Hvis du må forklare et trin, registreres det som hjælp, ikke som en selvstændigt gennemført opgave.

For hvert trin registreres: gennemført uden hjælp, gennemført med hjælp, eller ikke gennemført. Noter forventningen, det faktiske resultat og næste forsøg. Spørg til sidst, hvor projektet ligger, hvem der kan se det, hvem AI’en sender data til, og hvad en gemt version betyder.

Sproget vurderes ved at læse den faktiske plan og det færdige indhold. Noter engelske rester, sære ord, gentagelser og påstande om udførte tests. Design vurderes på læsbarhed, visuel sammenhæng, tastaturfokus, tomme tilstande og mobilvisning. En bestået kliktest kan ikke stå alene som sproglig eller visuel godkendelse.

## Fejl og opdatering

Fejlrapporten i appen indeholder faste statusfelter. Den medtager ikke samtaler, projektfiler, filstier, serveradresser, kontonavne eller nøgler. Hjælp og eksport af rapporten kontakter ikke nøgleringen. Brugeren vælger selv at gemme og sende rapporten. Et skærmbillede kan derimod indeholde projektdata og skal gennemgås før deling.

Ved opdatering lukkes appen. På Mac erstattes appen i Programmer; på Windows køres installationsprogrammet igen. Projektmapper og appens lokale datamappe skal bevares. Test opdateringen med syntetiske projekter først. Der er ikke automatisk opdatering eller automatisk upload af fejlrapporter.

Gendannelse ændrer kun de filer, der vises i gennemgangen. HEAD, commits og index bevares. Nye filer uden for historikken, ignorerede filer, installerede pakker og eksterne databaser bliver ikke rullet tilbage. Kopien før gendannelse ligger i appens lokale datamappe; den er ikke en online sikkerhedskopi. Store filer, symbolske links, Git LFS og særlige Git-forløb kan kræve et almindeligt Git-værktøj.

## Gentagelige tekniske prøver

### Installation på en Windows-testmaskine

Den automatiske Windows-prøve starter den pakkede `.exe` direkte. Følgende skal derfor også prøves med den konkrete NSIS-installationsfil og syntetiske projekter:

1. Hent filen som en inviteret tester, og sammenlign SHA-256 med filoversigten. Registrer appversion, Windows-version, arkitektur og om brugeren har administratorrettigheder.
2. Start installationen som almindelig bruger. Registrer eventuelle SmartScreen-, signatur- eller IT-politikbeskeder. Omgå ikke en blokering; aftal i stedet installation med den ansvarlige IT-afdeling.
3. Vælg en mappe med mellemrum, og kontroller genvejen samt appens navn. Åbn appen uden en udviklingsterminal. Opret et projekt i en sti med mellemrum og danske bogstaver, og prøv preview og versionsgemning. Maskinen skal ikke kræve en særskilt Git-, Node/npm- eller OpenCode-installation.
4. Gem en kladde, en designpakke og en forbindelse med syntetiske testdata. Luk appen, installer den næste version samme sted, og kontroller at projektfiler, kladde, design og forbindelsesvalg er bevaret. Afprøv forbindelsen igen uden at udskrive nøglen.
5. Afinstaller appen på testmaskinen. Kontroller at projektmapperne er bevaret, og registrer om appens indstillinger bevares. Installer igen og prøv genåbning. Slet kun syntetiske testdata, når observationerne er registreret.

Fra 0.4.0-beta.1 prøves desuden følgende på Windows, fordi det er nyt eller kun afprøvet på Mac:

6. Opdatér fra 0.3.0-beta.1 gennem appen i stedet for manuelt. Åbn Indstillinger, søg efter opdateringen, og vælg download og genstart som to særskilte valg. Kontroller, at en igangværende opgave udskyder genstarten, og at kladde og projektfiler er bevarede bagefter. Windows bruger installationsprogrammet til selve installationen.
7. Gennemgå Udgiv fra start til slut: vælg destination, log ind, vælg app og adresse, vælg hvem der kan åbne appen, og udgiv. Kontroller, at hver skærm stiller ét spørgsmål, at Tilbage virker, og at kvitteringen viser udgivelse, adgang og kontrol hver for sig. Brug en syntetisk app, og slet den bagefter.
8. Installer skills i et projekt, og kontroller, at de fire integrationer, herunder Promte og komplai Run, kan vælges til og fra. Kontroller, at projektets eget `AGENTS.md` bevares med afsnit og import, og at en sti med mellemrum og danske bogstaver virker.

Dette er en manuel prøvevejledning, ikke et registreret testresultat. Resultater og konkrete begrænsninger føres i [teststatus](teststatus.md). Indholdet af Windows-filen er kontrolleret på Mac; det erstatter ikke prøverne ovenfor.

### Kildekode og pakkede apps

Læs byggevejledningen i [desktop/README.md](../desktop/README.md), før der pakkes. Kør fra `desktop/`:

```sh
npm test
npm run test:introduction
npm run test:features
npm run test:app-skills
npm run measure:screens
npm run test:resume
npm run test:recovery
npm run test:frameworks
npm run test:concurrent
AURA_COPY_FRAMEWORK=astro npm run test:concurrent
```

`test:features` gennemgår Funktioner i Electron: første start med Vælg selv, undtagelser pr. projekt, et projekt uden versioner og genstart. `measure:screens` tæller synlige ord, valg, ⓘ og felter på alle skærme og tager et skærmbillede af hver. Kør den før og efter en ændring af en skærm. `test:app-skills` kører appens tilladelser og skills i den rigtige OpenCode med og uden Git. Den viser, at kun aktive skills kan hentes, og at ikke valgte private referencer, `.env` og `.git` afvises.

`test:recovery` bruger rigtig Electron, OpenCode, HTTP, Git og projektfiler. Modelserveren leverer kontrollerede svar og fejl. Den kontrollerer gendannelse, fortrydelse efter genstart, forkert nøgle, kvote, afbrudt strøm, Stop, ny opgave og en lokal fejlrapport. Git-commits oprettes kun i nye syntetiske testrepositories.

`test:concurrent` gennemgår projekt og kopi med flere rigtige motorer og en kontrolleret modelserver. Den bruger faktiske filer til både ren indfletning og konflikt, genstart og Fortryd uden Git samt rigtige Vite-servere på hver sin port. Varianten med `AURA_COPY_FRAMEWORK=astro` bruger Astro. Begge prøver indfletning, efter at frameworket har kørt i kopien, og at projektets server fortsætter, når kopiens server fjernes. De opretter også Git-versioner alene i det midlertidige projekt og kontrollerer billederne af den faktisk flettede version. De kontrollerer konkrete afvisninger af beskyttede filstier og WebSocket-forbindelser til den anden server. Skærmbilleder tages fra Electrons vindue, også ved zoom, og nye beslutningsområder måles særskilt. Native dialogers svar er simulerede; testen erstatter ikke observationen af en person uden udviklererfaring.

Den eksterne modelprøve kræver et eksplicit modelvalg. Nøglen indtastes skjult og bruges kun til syntetiske projektdata. Testen accepterer kun OpenRouter-modeller og ruter med oplyst nulpris; ingen betalt fallback. Eksempel med et model-id, hvis det fortsat findes i kataloget:

```sh
HARNESS_LIVE_SCENARIO=tasks HARNESS_LIVE_MODEL=google/gemma-4-31b-it:free npm run test:openrouter
```

Scenarierne `rooms`, `tasks` og `activities` kontrollerer plan, filændring, funktion, efterfølgende ændring og mobilbredde. De er afgrænsede HTML-prøver. Gennemgå også `plan.txt`, `samtale.txt` og skærmbillederne; automatisk godkendelse af sproglig kvalitet er ikke indbygget.

Som standard afviser prøven alle kommandoer. `HARNESS_LIVE_ALLOW_INSPECTION=true` vælger i stedet et forløb, hvor testeren godkender et fast udvalg af `pwd` og `ls` i det syntetiske projekt. Prompten fortæller modellen om valget. Kommandokæder, installationer og andre kommandoer afvises stadig; filændringer er begrænset til `public/index.html`. Registrer valget sammen med resultatet, så prøver med forskellige tilladelser ikke blandes sammen.

Begynderforløbet mod en rigtig model går gennem appens egen opsætning. Prøven åbner appen med den valgte udbyder og nøglevejledningen. Du indsætter selv nøglen i appvinduet og trykker Gem og kontrollér. Derefter kører prøven idé, plan, bygning, godkendelse og en rettelse. Den tager skærmbilleder og tæller tokens. Den gemmer planen, samtalen og de byggede filer. Prøven ser aldrig nøglen og sletter appens testdata med den krypterede nøgle bagefter. Mistrals gratis plan koster intet; andre udbydere kan koste penge:

```sh
HARNESS_LIVE_PROVIDER=mistral npm run test:live-app
```

Ollama eller en OpenAI-kompatibel server kan afprøves med samme scenarier. Vælg selv adresse og en installeret model med værktøjsstøtte. Kommandoen starter eller installerer ikke Ollama, modeller eller Tailscale:

```sh
HARNESS_LIVE_PROVIDER=ollama HARNESS_LIVE_URL=http://127.0.0.1:11434 HARNESS_LIVE_MODEL=MODEL_ID HARNESS_LIVE_SCENARIO=rooms npm run test:openrouter
```

Ved brug af `compatible` skal adressen omfatte API-basestien. Den automatiske prøve understøtter her kun egne servere uden nøgle; brug appens normale forbindelsesdialog, hvis serveren kræver en nøgle.

Pakkeprøve og opdatering på Mac, efter at begge versioner er bygget:

```sh
npm run test:package -- "release/beta.3/mac-arm64/AI Harness.app"
HARNESS_TEST_PACKAGE="release/beta.3/mac-arm64/AI Harness.app" npm run test:introduction
HARNESS_TEST_PACKAGE="release/beta.3/mac-arm64/AI Harness.app" npm run test:recovery
node scripts/verify-upgrade.cjs "release/beta.2/mac-arm64/AI Harness.app" "release/beta.3/mac-arm64/AI Harness.app"
npm run release:site -- release/beta.3
```

Opdateringsprøven erstatter appen på samme sted i en midlertidig mappe. Den bruger samme isolerede appdata før og efter og kontrollerer projektfiler, forbindelsen, en syntetisk krypteret nøgle og gemte designpakker. En kladde kontrolleres også, hvis den gamle version understøtter kladdelagring. Prøven ændrer ikke den normalt installerede app eller brugerens projekter. Mac'en skal være låst op under de grafiske prøver.
