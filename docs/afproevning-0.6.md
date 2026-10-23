# Lokal afprøvning af arbejdet mod Aura 0.6

Status 23. oktober 2026. Udgivelseskandidaten hedder `0.6.0-beta.1`. De første prøver nedenfor blev kørt med arbejdsmappeændringer oven på `0.5.0-beta.3`; de er ikke i sig selv kontrol af den nye installationsfil. Den installerede app og brugerens projekter er ikke opdateret af prøverne. [Udgivelsesvejledningen](udgivelse.md) gælder fortsat.

## Brugerforløb

- **Nyt projekt** er sidepanelets primære handling. Projektets **+** opretter en ekstra samtale. Første idé står som en redigerbar kladde i Byg; ekstra samtaler starter i Samtale.
- Projekter kan arbejde samtidigt med forskellige modeller. Svar, godkendelser, previews og opgavestatus tilhører det projekt og den samtale, der startede opgaven. Indstillinger og navigation forbliver tilgængelige.
- Et konkret forslag med fire planafsnit kan bygges direkte, også når det blev skrevet i Samtale. Skift til Byg medtager idéen og tidligere svar. Enter sender; Shift+Enter giver en ny linje.
- Accepteret modelsamtykke genbruges ved fortsættelse og skift af arbejdsmåde. Ændret model, modtager, vilkår eller private referencer kræver fortsat gennemgang. Projektets fil- og kommandotilladelser kan ses og fjernes.
- Udgivelsesflowet har tilbageveje, synlig arbejdsstatus og mulighed for kontoskift i Komplai. Ved offentlig udgivelse står det præcise appnavn ved bekræftelsesfeltet. Promte-konvertering går til Byg. Featurekontakter og informationsknapper har adskilte klikområder.
- Lokal forhåndsvisning genkender flere projekttyper og bevarer projektets browserlager. En vellykket lokal bygning beviser ikke i sig selv, at appens eksterne login og data fungerer hos en anden udbyder.

## Evidens

**Skrevet** betyder, at ændringen findes i arbejdsområdet. **Unit-testet** betyder, at afgrænsede kodeprøver består. **Kørt med reelt materiale** betyder, at den nævnte app, motor eller faktiske projektkopi er kørt. Kontrollerede servere er altid angivet. **Udgivet og observeret** kræver særskilt installations- og tjenestekontrol; ingen ændring i denne milepæl har nået det trin.

| Område | Nået trin | Faktisk prøve og afgrænsning |
|---|---|---|
| Flere projekter, modeller og afslutning | Kørt med reelt materiale | Rigtig Electron og OpenCode, tre samtidige projekter, modelvalg, baggrundssvar, sammenfatning og afslutning uden idle-events. Lokale kontrollerede modeller; ingen ekstern AI. |
| Samtale → Byg | Kørt med reelt materiale | Tidligere idé med i faktiske modelrequests. Et konkret samtaleforslag går direkte til bygning uden ekstra planrequest. |
| Kommandoisolation | Kørt med reelt materiale | Rigtig OpenCode-plugin og macOS-isolation, herunder automatisk bash uden modelcredentials. Separate prøver af npm-installation, underprocesser, symbolske links og adgang uden for projektet. |
| Skrivefelt, ny projektidé og kontoskift | Kørt med reelt materiale | Electron med kontrollerede model- og provideradaptere: Enter, Shift+Enter, Cmd/Ctrl+Enter, tekstkomposition, samtykke, Byg-kladde, Promte-konvertering og Komplai A → logud → B. Sidste prøve inkluderer plan-loop og synligt appnavn med specialtegn samt forkert/korrekt bekræftelse. |
| Udgivelsesdialoger | Kørt med reelt materiale | 21 skærme gennem Electron med kontrollerede udbydersvar. Forberedelse, bygning og upload viser spinner; fejl og tilbageveje afprøvet. Intet overløb ved 980 × 720 og 150 % zoom. |
| Komplai → Azure | Kørt med reelt materiale | Komplai-kvittering → Konto og adgang → Log ud → Tilbage → Azure samt Udgiv et andet sted → Azure. Den gamle kvittering, adresse og gemte destination bevares. Kontrolleret udbydergrænse; ingen rigtig kontoændring. |
| Promte-login og preview-adgang | Kørt med reelt materiale | Rigtig loginbackend, krypteret lager, proxy og IPC med kontrolleret browser/HTTP. Sent login A kan ikke erstatte B; logud afviser cached adgang før netkald. Testside, ikke det officielle appbibliotek. |
| Vite 5 og native Rollup på Mac | Kørt med reelt materiale | Den installerede Nodes signeringsfejl og Vites CJS-fejl er reproduceret i kopier. Den indledende prøve brugte ad hoc-signering; den afsluttende prøve med Developer ID-signeret pakke står nedenfor. |
| Promte-projektets npm-konflikt | Kørt med reelt materiale | Faktisk ERESOLVE reproduceret; den afgrænsede installationspolicy bygger den virkelige projektkopi med Vite og 15 cachede pakker. Ingen upload. Promte-login og data er stadig afhængige af Promte. |
| Skærmgennemgang | Kørt med reelt materiale | 41 skærme målt i Electron, ingen sidefejl. Skærmbilleder gennemgået. Tre versionsskærme udeladt for at undgå Git-skrivninger. Ingen observation med ny testperson. |
| Windows-stier, pakker og eksisterende data | Kørt med reelt materiale | Gamle Windows-ASAR-filer, NSIS-payload og gemte data kontrolleret på Mac. Stiregler afprøves med Win32-stier og kontrolleret filsystem; se slutkontrollen nedenfor. |

Den samlede kildeprøve ved første milepæl bestod med 80 målrettede tests og 13 forløb gennem rigtig Electron/OpenCode, herunder automatisk filændring, husket præcis kommando med bred automatisk kørsel slået fra og forsinket IPC-svar under projektskift. Der var 23 kontrollerede modelrequests og ingen fejl. Windows-forløbet er en simulation med gamle forbindelser og workspace-v1. Senere prøver af de afsluttende rettelser står under slutkontrollen nedenfor.

Første lokale pakning afslørede, at electron-builder flyttede to SDK-afhængigheder, så den eksterne agentmotor ikke kunne læse dem uden for apparkivet. Pakkereglerne blev rettet og unit-testet. Den daværende diagnostikpakkes eksterne resolver og hele motorforløbet bestod: 14 kontroller, 23 lokale modelrequests og ingen fejl. Det inkluderede samme 13 kildeforløb, faktisk kommandoisolation, automatisk filadgang og en præcis husket kommando med bred automatisk kørsel slået fra.

Den daværende diagnostikpakke blev bygget i `/private/tmp/aura-0.6-lokalpakke.w2pOWk` med `--dir`, uden Developer ID-signering, notarisation eller installation. 114 appfiler, 32 profilfiler, direkte runtimeafhængigheder og runtime-låseoplysninger matchede den daværende kildekode. Pakken havde ingen `app-update.yml` og kunne derfor ikke bestå releasekontrollen som en distributionspakke. Den midlertidige appkopi er ryddet efter afprøvningen af den signerede beta.1-pakke; rapporten er bevaret. Dette er en historisk kontrol, ikke af CI, opdateringsmekanismen eller den endelige beta.1-pakke.

Den særskilte `verify-package.cjs` bestod også: pakket opstart med isolerede brugerdata og begrænset PATH, medfølgende OpenCode/Git/Node/npm, faktiske filer fra projektfunktionen og rigtig forhåndsvisning. Prøven opretter ingen Git-historik og afprøver derfor ikke automatisk versionsgemning eller Gem version. Resultatet og skærmbilledet ligger i `harness-package-yGbrti` i testmaskinens midlertidige mappe.

## Reproducerbare prøver

Kør fra `desktop/` med den medfølgende Node-version. Electron-prøver åbner appvinduer og bruger nye midlertidige datamapper. De ændrer ikke den installerede Aura eller rigtige brugerprojekter. De relevante scripts blokerer Git-skrivninger.

```bash
node scripts/verify-multi-project.cjs
node scripts/verify-composer-actions.cjs
node scripts/verify-deployment.cjs
node scripts/verify-publishing-switch.cjs
node scripts/verify-promte-preview.cjs
node scripts/verify-komplai-preview.cjs
AURA_MEASURE_NO_GIT=1 node scripts/measure-screens.cjs /private/tmp/aura-skaerme
```

`verify-native-runtime.cjs` og `verify-promte-build.cjs` tager eksplicitte projekt-/appstier og arbejder i nye kopier. De faktiske inddata skal læses først. Kør ikke alle gamle testfiler ukritisk: nogle historiske fixtures opretter Git-commits og hører ikke til denne prøvekørsel.

Lokale rapporter fra de gennemførte prøver findes i testmaskinens midlertidige mappe:

- `aura-flere-projekter-DhiW1L/rapport.json`: kildeprøve ved første milepæl, 13 forløb, 23 modelrequests, ingen fejl.
- `aura-flere-projekter-FZVrc3/rapport.json`: pakket app, 14 kontroller, 23 modelrequests, ingen fejl.
- `aura-skrivefelt-lH6DEE`: sidste skrivefelt-, plan-, navnebekræftelses- og kontoprøve; 9 forberedelser og 8 afsendelser.
- `aura-del-cloud-QEgQeg`: 21 udgivelsesskærme, herunder mindre vindue, forstørret tekst, status og fejlgendannelse.
- `aura-udbyderskift-q0TRSw/rapport.json`: begge veje fra en eksisterende Komplai-udgivelse til Azure; den tidligere kvittering bevares.
- `aura-promte-preview-HUqVmZ/rapport.json`: login, kontoskift, sene svar og logud gennem den rigtige backend.
- `aura-native-runtime-hAOsZD/rapport.json`: native signeringsfejl og Vite 5-regression.
- `aura-promte-byg-kfjxWB/rapport.json`: faktisk ERESOLVE før rettelsen og vellykket bygning efter.
- `/private/tmp/aura-0.6-after-no-git/maalinger.json`: 41 skærme, 0 sidefejl. Ingen fuld førmåling; tallene er ikke en før/efter-sammenligning.

Rapporterne er lokale prøveresultater og distribueres ikke med appen.

## Kompatibilitet og udgivelsesgrænser

- React med Vite og statisk Astro kan ende som browserfiler til Komplai Run. SSR, Python-servere, databaser og baggrundsjob bliver ikke til browserfiler af den grund. Den nuværende Komplai-integration starter ingen Python-server.
- Automatisk kommandokørsel kræver understøttet OS-isolation. Uden understøttelse kræver kommandoer enkeltgodkendelse; tidligere gemte regler må ikke blokere almindelige byggeopgaver eller give automatisk adgang. Et udtrykkeligt valg af bred automatisk kommandokørsel afvises, når isolation mangler.
- App-ID, datamappens identitet og nøglelager ændres ikke. Gamle indstillinger får ikke automatisk bredere tilladelser. Dette er ikke en garanti for fejlfrie opdateringer på uprøvede maskiner.
- Kommunernes Promte-værter og loginrettigheder er uændrede. Der er ikke gennemført en ny offentlig udgivelse hos Promte, Komplai eller andre udbydere i disse prøver.
- Udgivelseskandidaten offentliggøres først efter pakkekontrol, Mac-signering og notarisation samt de særskilte manuelle release- og Pages-kørsler. Brugeren har godkendt disse trin samt commit, tag og push for `0.6.0-beta.1`. En lokal pakke alene validerer ikke et senere CI-byg.

## Slutkontrol af 0.6.0-beta.1

- **Fil- og mappeidentitet:** 39 målrettede tests efter sidste ændring. En senere Electron/OpenCode-prøve af mappeidentitetsrettelsen bestod med 13 forløb og 23 lokale modelrequests (`aura-flere-projekter-cha2d2`). Derefter blev læsebeskyttelsen kontrolleret særskilt mod samme syntetiske materiale før og efter: på Mac gav `.ENV` og et neutralt symlink til `.env` tidligere beskyttede bytes til modellen; begge veje blev afvist efter rettelsen, mens en almindelig fil blev læst uden ekstra godkendelse. Rapporter: `aura-readguard-review-YQO3Fc/before/rapport.json` og `after/rapport.json`.
- **Referencer og almindelig læsning:** den bredere prøve af den endelige læsebeskyttelse bestod med 17 værktøjskald og 18 lokale modelrequests. Aktiv skill-reference, valgt projektreference, almindelig fil og almindeligt link kan læses. Øvrige referencer og beskyttede navne/linkmål afvises. En almindelig fil skrives efter ét godkendelseskort. Rapport: `aura-filgraenser-Okj6Fw/rapport.json`.
- **Gamle opdateringsklienter:** `verify-update-compatibility.cjs` indlæser den faktiske updater fra Windows-ASAR-filerne i 0.5.0-beta.1, beta.2 og beta.3. Alle tre accepterer kandidatens feed til Apple Silicon, Intel og Windows x64. Manuel download/installation, fravalgt automatisk søgning, forkert arkitektur, hash, domæne og versionsrækkefølge kontrolleres. Prøven bruger syntetiske downloadbytes og foretager ingen installation. Rapport: `/private/tmp/aura-0.6-update-compatibility.json`.
- **Opdatering gennem Electron:** den faktiske klient henter fra en lokal HTTP-server, viser fremdrift, afviser forkert SHA-512, gemmer kladden og afviser genstart under arbejde. Installationskaldet opsamles. Rapportmappe: `aura-update-ui-5eqr3X`.
- **Tidligere Windows-data:** den faktiske 0.5.0-beta.3-ASAR opretter syntetiske indstillinger, forbindelser, historik og arbejdskopier, som de nye moduler læser. Ukendte felter og krypterede bytes bevares. Drev-, UNC- og extended-stier bevares. Krypteringen er kontrolleret AES, og prøven kører på Mac. Rapport: `aura-windows-opgradering-DL38be/rapport.json`.
- **NSIS-indhold:** den første diagnostiske beta.1-pakke indeholdt 6.100 filer, der var byteidentiske med den kontrollerede `win-unpacked`-mappe. Alle 23 plugin- og transitive pakker lå fysisk uden for ASAR som krævet. Produktændringer efter denne prøve kræver en ny pakke og ny kontrol. Rapporter: `desktop/release/0.6.0-beta.1/windows-dCKue0/diagnostic-audit.json` og `payload-check.json`.
- **Endelig Windows-installationsfil:** `windows-final-C2Cb0t/Aura-0.6.0-beta.1-win-x64.exe` er bygget efter de afsluttende filrettelser. Alle 6.100 faktiske NSIS-filer matcher den udpakkede app byte for byte. 115 kildefiler, 32 profiler, 23 pluginpakker, PE-version, ikon og ASAR-headerkontrolsum er kontrolleret. Node, Git og OpenCode har præcis samme bytes som beta.3. App-ID, NSIS-GUID, databevarelse og opdateringskanal er uændrede. Installerens SHA-256 er `4ef6fc37b32f11f4be90fd9bd20de7a6d396a563c53b92a7c8039c76f1e0aeed`; rapporter og fulde filmanifester ligger ved installeren. Syv tilhørende enhedsprøver består.
- **Signeret Apple Silicon-pakke:** `arm64-signed/mac-arm64/Aura.app` indeholder de samme 115 kildefiler og 32 profiler. Developer ID-signaturen består med macOS' normale certifikatadgang. Den faktiske pakke starter med isolerede data og begrænset PATH, bruger de medfølgende værktøjer og viser projektets forhåndsvisning (`harness-package-Nqi4cp`). Derefter består 14 motorforløb med 23 kontrollerede lokale modelrequests, herunder samtidige projekter, almindelig filadgang uden kommandosandbox, isoleret kommando og husket præcis kommando. Rapport: `aura-flere-projekter-u4K35q/rapport.json`.
- **Azure mod rigtig tjeneste:** Azure normaliserede `harness-test` til `harnesstest`. Statusopslaget genkender begge navne og bevarer kravet om en ny nok udgivelse. Den faktiske `Deployments.check` fandt READY, HTTP 200 og samme SHA-256 for startsiden som i brugerens gemte kvittering. Kvitteringen blev kun læst; prøven uploadede ikke og ændrede ikke brugerens data. 13 regressionstests består. Rapport: `/private/tmp/aura-0.6-azure-status.json`.
- **Native pakker i den signerede app:** `verify-signed-native-runtime.cjs` kørte pakkens Developer ID-signerede Node mod native Rollup fra en kopi af det faktiske Vite-projekt. Pakkens fysiske runner serverede både startsiden og kompileret JSX med HTTP 200. Appens signatur bestod før og efter. Rapport: `aura-signeret-runtime-uRdTYq/rapport.json`.

De native opgraderingsprøver kan køres med `verify-windows-nsis-upgrade.cjs` på en isoleret Windows-konto. Scriptet afviser eksisterende Aura-registrering, processer og appdata og kræver verificerede installere. Det er særskilt fra filkontrol og kompatibilitetsprøverne ovenfor.

## Endelige Mac-filer og downloadkontrol

Alle seks Apple-indsendelser er godkendt. De fire endelige Mac-filer ligger i `final-arm64` og `final-x64` med hver sin `.notarized.json`-kvittering. `verify-mac-artifacts.cjs` består for begge arkitekturer: original app, skrivebeskyttet DMG og udpakket ZIP har samme 8.941 filer og 162 links, og hver kopi består kildekontrol, kodesignatur, notarbillet og macOS' distributionskontrol. Begge rapporter hedder `artifact-check.json`. Prøven er kørt på denne Apple Silicon-Mac; Intel-kontrollen er en kontrol af pakken, ikke kørsel af appen på Intel.

De fem programfiler er samlet med APFS-kopier i `downloads`, og `release-site.cjs` har dannet manifest og kontrolsummer. `verify-download.cjs` har hentet alle tre installationsfiler gennem en lokal browser og verificeret filnavne, størrelser og SHA-256. Desktop- og mobilskærmbilleder er gennemgået (`harness-download-QVvbEL`). Dette er lokal downloadkontrol, ikke offentlig udgivelse.

Den fulde native opgraderingsprøve fra 0.5.0-beta.3 til 0.6.0-beta.1 består på denne Apple Silicon-Mac. Den tidligere pakkes egen opdateringscontroller hentede den endelige signerede ZIP, og Squirrel.Mac installerede den. Efter kontrolleret genåbning var projektfiler, forbindelse, krypteret testnøgle, design og kladde bevaret. Ingen automatisk modelsendelse eller Git-skrivning fandt sted. Rapport og gennemgået skærmbillede: `aura-upgrade-sRQX50`. Automatisk genstart er særskilt fra denne isolerede prøve.

Det første forsøg (`aura-upgrade-63eA7u`) ventede på macOS' nøglelager og overskred derefter installationsprøvens grænse. Ved gentagelsen med længere tilladt ventetid og brugerens macOS-godkendelse afsluttede installationen normalt. Ingen kontrol blev sprunget over, og ingen produktkode blev ændret på grundlag af ventetiden.
