# Afprøv Aura CLI på Linux

CLI'en kræver Node 22.12 eller nyere, npm og Git på en udviklingsmaskine. Der er motorpakker til x64 og arm64 med glibc og musl. **Den aktuelle CLI er endnu ikke afprøvet på Linux.** Desktopappen distribueres nu også som en usigneret AppImage til Linux x64 (glibc); se [pakkevejledningen](../desktop/README.md#installationspakker--beta) og [udgivelsesvejledningen](../docs/udgivelse.md). CLI'en selv distribueres som npm-pakke på tværs af platforme.

## Hent og installer

Åbn [terminalsiden](https://ai-alliancen-org.github.io/ai-harness/terminal.html). Når en CLI-beta er udgivet, henter du npm-pakken og `SHA256SUMS.txt` fra samme udgivelse. Læg dem i en ny mappe, fx `~/Downloads/aura-cli`. Pak ikke `.tgz` ud. Kommandoerne her gælder `0.2.0-beta.6`; brug udgivelsens faktiske filnavn.

```sh
cd "$HOME/Downloads/aura-cli"
node --version
npm --version
git --version
sha256sum aura-harness-0.2.0-beta.6.tgz
cat SHA256SUMS.txt
```

Sammenlign pakkens kontrolsum med listen og med terminalsiden. Stop ved forskel. `CLI-RELEASE.json` på GitHub angiver kildecommit og pakkens indhold. En kontrolsum viser identitet, ikke en sikkerhedsgodkendelse.

```sh
npm install --include=optional --ignore-scripts --no-audit --no-fund --no-save ./aura-harness-0.2.0-beta.6.tgz
./node_modules/.bin/aura doctor
```

Der kræves ingen global installation eller `sudo`. npm henter den fastlåste OpenCode-motor, der passer til Node-processens platform. Aura ændrer ikke din øvrige OpenCode-opsætning. `doctor` skal finde Node, Git og OpenCode 1.18.33. Stop ved fejl. Se efter manglende diskplads, blokeret netadgang eller udeladte valgfrie afhængigheder. Slå ikke organisationens sikkerhedskontrol fra. Der installeres ingen Docker eller projektpakker ved opstart.

## Første prøve

Vælg et særskilt datalager og en eksisterende overmappe til et nyt, syntetisk projekt:

```sh
export AURA_HOME="$HOME/.local/share/aura-cli-linux-test"
./node_modules/.bin/aura init "$HOME"
```

Kald projektet `Aura Linux prøve`. Beskriv en kalender med opdigtede aktiviteter. Brug en AI-forbindelse, du har adgang til; en betalt model bruger din udbyders kvote. Der medfølger hverken model eller kreditter. API-nøgle og adgangssætning indtastes skjult. Nøglelageret bruger adgangssætningen og kræver ingen grafisk nøgletjeneste.

1. Send idéen, og gennemgå planen. Planlægning må ikke skrive filer.
2. Vælg `/build`, godkend en filændring, og åbn `/preview` i browseren.
3. Bed om en ændring, afvis den og kontroller filer og `/diff`.
4. Stop en opgave med Ctrl+C. Kontrollér, at en ny opgave kan startes.
5. Afslut med `/exit`, og genåbn med kommandoen nedenfor. Kontroller historik, modelvalg, filer og nøglelager. En forkert adgangssætning må ikke slette data.

```sh
./node_modules/.bin/aura resume
```

Prøv både en grafisk terminal og en session uden nøgletjeneste. Test æ/ø/å og projektmapper med mellemrum. Start kun én Aura-proces med samme datalager. `/save` og `/versions` kan afprøves i det syntetiske projekt; de kan oprette lokale commits. Undlad `/deploy` i installationsprøven.

## SSH og servere uden skærm

Du kan bruge CLI'en i en interaktiv SSH-terminal med en API-nøgle eller en lokal AI. Nøglen indtastes skjult i terminalen og gemmes i Auras krypterede lager.

Preview-adressen lytter på serverens loopback, ikke på dit lokale skrivebord. Hvis du kender SSH, kan du videresende den viste port med SSH's port forwarding. Aura åbner ingen firewall eller offentlig port automatisk. Tailscale er et separat valg og sættes ikke op af pakken.

## Opdatering og tilbagemelding

Afslut Aura før opdatering. Tag en privat sikkerhedskopi af projekter og datalager. Hent den nye udgivelse i en ny installationsmappe, kontroller den og brug samme `AURA_HOME`. Bevar den gamle installation, indtil den nye er afprøvet. Et nyere dataformat kan kræve gendannelse fra sikkerhedskopien ved tilbagerulning.

Oplys distribution, arkitektur, glibc/musl, Node/npm/Git-version, CLI-version, kildecommit og SHA-256. Notér resultater for installation, login, plan, bygning, afvisning, stop, preview og genåbning. Beskriv også, om prøven brugte grafisk terminal eller SSH. [Opret en fejlrapport](https://github.com/ai-alliancen-org/ai-harness/issues/new/choose). Del ikke tokens, adgangssætninger eller private samtaler. Sikkerhedsfejl følger [den private kanal](https://github.com/ai-alliancen-org/ai-harness/blob/main/SECURITY.md).

Installation, projektfiler og datalager ligger hver for sig. Sletning af installationen sletter ikke projekterne og tilbagekalder ikke nøgler hos en udbyder.
