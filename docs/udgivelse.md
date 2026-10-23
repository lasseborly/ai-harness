# Udgiv en desktopbeta

Terminalpakken har [sit eget udgivelsesforløb](udgivelse-cli.md) med tags, der begynder med `cli-v`. Den omfatter Windows, Linux og macOS og ændrer ikke desktopappens krav om platformsprøver og notarisation.

Installationsfilerne ligger i GitHub Releases. [GitHub Pages](https://ai-alliancen-org.github.io/ai-harness/) viser downloadknapper til den seneste publicerede version med gyldige installationsfiler. Begge udgivelser kræver en særskilt, manuel kørsel. Et commit eller push starter ingen af dem.

## Klargør den konkrete version

1. Opdatér `desktop/package.json` og rodpakken i `desktop/package-lock.json` til samme version. Gennemgå ændringerne og de relevante tests. Brugeren håndterer commit, push og tag.
2. Byg fra den gennemgåede kode efter [pakkevejledningen](../desktop/README.md#installationspakker--beta). Brug en ny outputmappe for hver platform og bygning. Bevar tidligere testede filer.
3. Kør `desktop/scripts/verify-package-source.cjs` med pakkens ressourcemappe og målplatform: `darwin-arm64`, `darwin-x64`, `win32-x64` eller `linux-x64`. Kontrollen sammenligner den faktiske appkode og profiler med arbejdsmappefiler, som er fulgt af Git, og runtime-manifestet med låsefilen. Den kontrollerer ikke alene installation eller signering.
4. Afprøv den pakkede app og dens medfølgende værktøjer. Notér, om prøven er kørt på den rigtige målplatform. En Windows-pakke bygget på Mac er stadig uprøvet på Windows.
5. Signér og notariser begge Mac-pakker efter [Apple-forløbet](../desktop/README.md#apple-notarisation): de to første DMG'er og derefter den endelige DMG og ZIP til hver arkitektur. Send én fil ad gangen på en fast forbindelse, ikke en mobil hotspot, og hold Mac'en vågen med `caffeinate`. Falder forbindelsen ud, køres samme kommando igen; scriptet genoptager fra det gemte indsendelses-id og sender ikke filen igen. Efter en afbrudt upload sendes filen kun igen med `--send-igen`. Kontrollér både appen og det endelige diskbillede. En ny pakning eller signering kræver nye kontrolsummer og relevante kontroller.

Ved ændringer i appkode eller profiler efter pakningen skal pakken bygges og kontrolleres igen. Et korrekt versionsnummer beviser ikke, at indholdet svarer til kildekoden. `verify-package-source.cjs` skal også bestå mod den kildeversion, der får udgivelsens tag.

## Saml filer og dokumentation

Fra denne udgivelse samles fire installationsfiler, to Mac-arkiver og én Linux AppImage til opdateringsfunktionen i en ny lokal mappe:

- `Aura-VERSION-mac-arm64.dmg`
- `Aura-VERSION-mac-x64.dmg`
- `Aura-VERSION-win-x64.exe`
- `Aura-VERSION-linux-x64.AppImage`
- `Aura-VERSION-mac-arm64.zip`
- `Aura-VERSION-mac-x64.zip`

Mac-arkiverne skal indeholde den samme signerede og staplede app som DMG-filerne. Kontrollér det udpakkede arkiv med `verify-package-source.cjs`, `codesign`, `stapler validate` og `syspolicy_check distribution`. Notariser også den konkrete ZIP; `notarize.cjs` gemmer en `.notarized.json`-kvittering med dens SHA-256. ZIP-filer kan ikke selv staples.

Linux AppImage'en er usigneret og bliver det også i denne beta. Udgivelsesnoterne skal sige det uden omsvøb og vejlede i at fjerne udflagsningen før første start; downloadsidens detaljetekst gør allerede opmærksom på det. AppImage'en er afprøvet på en enkelt x64-maskine med glibc og GNOME-nøglering; arm64 og musl distribueres ikke.

Opdatér `desktop/packaging/update-notice.json` til versionen. Ved en kritisk rettelse sættes `critical` til `true`, og `message` beskriver rettelsen kort. Det giver en vedvarende advarsel, aldrig en blokering eller tvungen installation.

En `.notarization-pending.json` ved siden af en fil betyder, at Apple-forløbet for filen ikke er afsluttet. Kør `notarize.cjs` igen for filen, før den samles. Ventefiler skal ikke med i udgivelsen.

Læg Mac-filernes `.notarized.json`-kvitteringer ved siden af filerne, og kør fra `desktop/`:

```bash
node scripts/release-site.cjs release/udgivelseskandidat
```

Erstat mappen med den faktiske mappe. Scriptet danner `release.json`, `SHA256SUMS.txt` og en lokal downloadside. Det læser versionen fra filnavnene og afviser blandede versioner. En Mac-kvittering tæller kun, hvis den har status Accepted, et indsendelses-id, en kontroldato og samme SHA-256 som filen. En kvittering er lokal dokumentation; Linux-kontrollen hos GitHub foretager ikke selv Apples signatur- eller billetkontrol.

Afprøv download med `node scripts/verify-download.cjs release/udgivelseskandidat`. Installationsfiler, Apple-kvitteringer, ventefiler og lokale rapporter skal ikke committes. Udgivelsesnoterne skal beskrive faktisk signering og afprøvning samt kendte begrænsninger. Se [udgivelsesnoterne for 0.5.0-beta.3](releases/0.5.0-beta.3.md).

## Kontrol af Komplai Run

Komplai bruges kun til udgivelse via Udgiv. Før en version med ændringer i Run-forløbet offentliggøres, skal login, organisationsvalg, udgivelsesadgang, offentlig og privat udgivelse samt tilbagekaldelse kontrolleres efter ændringernes omfang. Brug syntetisk indhold og isolerede testdata. Skeln mellem kontrollerede serversvar, rigtig tjeneste og pakket app i teststatus.

En gammel Komplai-AI-forbindelse må ikke kunne hente modeller eller sende opgaver. Den skal kunne fjernes uden at påvirke Run-adgangen. Ingen modelkald, kreditregnskab eller Komplai-specifik AI-kontrol indgår i releaseworkflowet. Tokens og lokale appdata må ikke indgå i udgivelsen.

## Fra gennemgang til offentlig download

1. Brugeren gennemgår, committer og pusher kildekoden og opretter et versionstag, fx `v0.5.0-beta.2`, på det gennemgåede commit. Tagget skal pege på samme commit som den `main`, workflowet startes fra. Ingen tag oprettes af workflowet.
2. Opret en **kladde** i GitHub Releases med det eksisterende tag og betamarkeringen slået til. Upload præcis de fem programfiler, `release.json` og `SHA256SUMS.txt`. Brug de gennemgåede udgivelsesnoter. Upload ikke lokale logs, Apple-loginoplysninger, builderens foreløbige YAML-filer eller testdata.
3. Giv udtrykkelig tilladelse til den konkrete kørsel af **Offentliggør gennemgået desktopbeta**. Vælg `main`, angiv tagget og bekræft offentliggørelsen. Workflowet bygger ikke nye installationsfiler.
4. Workflowet kontrollerer tag, version, offentlig adgang, kladdens indhold, størrelser, SHA-256, SHA-512 og Mac-kvitteringer. Det downloader og kontrollerer de faktiske installationsfiler. Manglende eller ændrede oplysninger stopper udgivelsen.
   Kladden og dens otte filer hentes via deres GitHub-ID’er med `scripts/download-desktop-draft.cjs`. Et opslag via `releases/tags/TAG` kan give 404 for en kladde. GitHubs midlertidige `untagged-…`-adresser accepteres kun under kladdekontrollen; den offentlige side kræver adresser med det rigtige versionstag.
5. Giv derefter særskilt tilladelse til **Udgiv downloadside** med `offentlig_udgivelse` slået til. Der er ingen automatisk Pages-kørsel efter en Release. Pages bygger også opdateringsfeeds fra den offentliggjorte `release.json`, hvis dens SHA-256 matcher GitHubs filoplysninger. Kladders filer og CLI-udgivelser bliver aldrig tilbudt som appopdateringer. Betakanalen og den stabile kanal holdes adskilt.
6. Åbn Pages uden GitHub-login, hent hver offentlig installationsfil og kontrollér dens kontrolsum. Afprøv installation og opdatering på de maskiner, som betaen beskrives som afprøvet på. Registrér version og resultater i [teststatus](teststatus.md).

**Byg testpakker** er et separat, manuelt workflow til platformskontrol. Det gemmer midlertidige Actions-artefakter og offentliggør ingen Release. Dets Mac-pakker er som udgangspunkt usignerede og kan ikke passere udgivelseskontrollen ovenfor.

## Afprøv opdateringen

Beta.6 har ingen indbygget opdateringsklient. Installer 0.3.0-beta.1 manuelt én gang. Afprøv på Mac, Windows og Linux med et eksisterende projekt, en gemt forbindelse og en beskedkladde. Kontrollér, at data stadig kan læses, at ingen modelopgave sendes automatisk, og at gamle projekter åbner normalt.

Den nye klient bruger electron-updater 6.8.9 og platformens installationsprogram. Den søger ved opstart og hver sjette time, når automatisk søgning er slået til. Kørsel fra kildekoden kontakter ikke opdateringstjenesten. Download og installation er to særskilte valg. En opgave, en indfletning, en igangværende pakkeinstallation eller en udgivelse forhindrer genstart; det er en beskyttelse af arbejdet, ikke et krav om opdatering. Almindelig lukning installerer ikke en hentet opdatering.

`npm run test:updates` afprøver den faktiske klient, UI og HTTP-download mod en lokal server, herunder forkert SHA-512, fremdrift og gemt kladde. Installationskaldet opsamles i den prøve. Den native installation skal desuden køres mellem to signerede Mac-pakker og mellem to installerede Windows-versioner. En vellykket download er ikke bevis for, at installationen lykkes.

`node scripts/verify-upgrade.cjs TIDLIGERE.app NY.app` fra `desktop/` prøver manuel udskiftning med isolerede brugerdata. Tilføj stien til den nye signerede og notariserede ZIP efter de to appstier for at bruge Squirrel.Mac til selve installationen. Beta.6 mangler opdateringsklienten, så prøven indlæser den nye klient i testprocessen uden at ændre den signerede gamle app. Det afprøver installationsmekanismen, men betyder ikke, at almindelige beta.6-installationer kan opdatere sig selv. Scriptet åbner appvinduer og må ikke køres under en demo.

En særskilt installationsprøve uden nøglelagring vælges med `--installation-only` efter ZIP-stien:

```bash
node scripts/verify-upgrade.cjs TIDLIGERE.app NY.app NY.zip --installation-only
```

Valget springer gemning og brug af den krypterede testnøgle og forbindelse over. Det afprøver installation, projektfiler, design og kladde uden at kalde nøgleringen til nøglelagring. Det erstatter ikke den fulde prøve af databevarelse, herunder gemte forbindelser og krypterede nøgler. Begge native varianter genåbner appen kontrolleret med isolerede brugerdata; automatisk genstart er ikke dækket, fordi Squirrel ikke viderefører `--user-data-dir`.

Filerne hentes fra dette repositorys GitHub Releases over HTTPS. SHA-512 kontrollerer downloadens indhold mod feedet; det er ikke en uafhængig udgiversignatur. Mac kontrollerer også appens kodesignatur. Windows-betaen er fortsat usigneret og har derfor ikke en Authenticode-kontrol af udgiverens identitet. Det samme gælder Linux AppImage'en; den henter `beta-linux.yml` og erstatter sig selv, når appen er startet fra AppImage-filen, så `APPIMAGE` er sat. Kører appen fra en udpakket mappe, er automatisk opdatering slået fra. GitHub-adgang, manuel gennemgang af udgivelser og beskyttelse af Pages er en del af tillidsgrundlaget. Slå ikke platformens signaturkontrol fra for at få en opdatering igennem.

Opdateringen ændrer ikke app-ID, datamappens navn eller nøglelagerets identitet. Ved tilbageførsel offentliggøres en ny, højere version med rettelsen. Installer ikke automatisk en lavere version over en nyere datamappe. En kritisk meddelelse gemmes lokalt og bliver stående ved netfejl, indtil den berørte version er opdateret. Brugeren kan fortsætte sit arbejde imens.

Officiel vejledning: [electron-updater](https://www.electron.build/v26/docs/features/auto-update/).
