# Udgiv til Promte Apps

Promte Apps kræver konto, betalt aftale og administratoradgang i det valgte app-arbejdsområde. Brugeren logger ind hos organisationens egen Promte-installation. Adgang til at udgive er forskellig fra de besøgendes adgang til appen; den sidste kontrolleres i arbejdsområdet.

## Forbindelse og destination

1. Vælg **Promte Apps** i Udgiv, og angiv organisationens Promte-adresse. Standardadressen er `https://kodning.promte.dk`.
2. Installér Promtes officielle uploadværktøj, hvis det ikke allerede findes. Aura installerer ikke pakker automatisk.
3. Vælg login i Aura. Promtes værktøj åbner browseren, hvor brugeren godkender CLI-adgangen.
4. Kopiér app-arbejdsområdets ID fra dets adresse i Promte. Aura bruger ingen udokumenteret søgning efter arbejdsområder.
5. Vælg mappen med appens kildekode, og gem ændringerne som en version før gennemgang.

Installationskommandoen henter en pakke fra npm og køres af brugeren:

```sh
npm install --global @promte/app-upload@0.2.0
```

Ved en særskilt lokal installation kan `HARNESS_PROMTE_PATH` angive den fulde sti til værktøjet ved start af Aura.

Login gemmes af det officielle værktøj i `~/.config/promte/credentials.json`, eller under `XDG_CONFIG_HOME`. Aura læser kun den post, der svarer til den valgte HTTPS-vært. Adgangstokens sendes aldrig til brugerfladen eller projektkonfigurationen. Projektet gemmer kun adresse, arbejdsområde og kildekodemappe.

## Kildekode og gennemgang

Promte-adapteren modtager en React-app, som følger [Promte-skillens byggeregler](../profiles/skills/harness-integration-promte/references/promte.md). Promte leverer sit eget byggeforløb. En almindelig backendserver eller vilkårligt skrivebordsprogram kan ikke udgives ad denne vej.

Udgiv kontrollerer projektets filer på computeren med de samme regler, før brugeren logger ind hos Promte. Et almindeligt Aura-projekt, hvor hjemmesiden ligger i `public/` uden `package.json`, får en forklaring og to valg: **Gør projektet klar til Promte** eller **Vælg en anden udbyder**. Det første slår Promte-integrationen til for projektet, så AI’en kender reglerne, og lægger en besked i skrivefeltet, som brugeren selv sender. Gennemgangen af den gemte version bruger fortsat reglerne og forklarer en afvisning på samme måde.

Aura kræver, at installationen bekræfter kildekodeupload. Der er ingen automatisk overgang til ældre serveres upload af færdigbyggede filer.

Udgivelsen pakkes direkte fra de gennemgåede filer i den gemte Git-version. Lokale, ugemte filer følger ikke med. Promtes officielle udeladelsesregler anvendes før gennemgangen: blandt andet byggeoutput, lokale værktøjsmapper og `vite.config.*` kommer ikke med. `package-lock.json` udelades, når projektet kun har udviklingsafhængigheder, ligesom i Promtes CLI. Listen og indholdets kontrolsum beregnes derefter, så gennemgangen svarer præcis til den uploadede pakke. Projektets egne filer ændres ikke.

Kildekoden kan modtages af den valgte installation eller Promtes dokumenterede fælles uploadtjeneste på `app.promte.dk`. Begge modtagere står i destinationens gennemgang. Andre uploadværter afvises. Det almindelige login sendes kun til den valgte installation; upload bruger den særskilte engangsnøgle fra Promte.

Denne adapter kræver en offentlig HTTPS-adresse. Private netværksadresser og direkte IP-adresser afvises. Et rent internt Promte-miljø kræver en særskilt godkendt forbindelse og er ikke understøttet af denne adapter.

## Status og gentagne forsøg

Promte reserverer først et versionsnummer, modtager dernæst kildepakken og afslutter med bygning og gennemgang. Aura gemmer versionsnummeret før upload og den bekræftede modtagelse før afslutning. Hvis forbindelsen afbrydes, kan den samme version kontrolleres igen.

Status `reviewing`, `building`, `blocked` eller `rejected` bliver ikke vist som en færdig udgivelse. Kun `published` betyder, at Promte selv melder versionen udgivet. Aura kontrollerer den konkrete version, aldrig blot den seneste version i arbejdsområdet.

Den publicerede CLI-kontrakt lover ingen bestemt appadresse i statussvaret. Aura gætter derfor ikke et applink. Åbn Promte, find appen, og afprøv den med den tilsigtede bruger. En udgivet version beviser ikke, at appens brugerforløb eller adgang er afprøvet.

## Kilder og afprøvning

- [Promtes beskrivelse af egne apps](https://promte.com/blog/byg-dine-egne-ai-apps-vi-hoster-dem)
- [Det officielle uploadværktøj](https://www.npmjs.com/package/@promte/app-upload), version 0.2.0: browserlogin og kontrakterne `capabilities`, `prepare`, `upload-app`, `finalize` og `releases`.
- [Promtes aftaler og priser](https://promte.com/pricing) og [kontakt om en aftale](https://promte.com/kontakt).

Adapteren er skrevet og enhedstestet med ni tests af adgang, modtagere, kildepakke, afbrudt upload og status. Forløbet er også kørt i den rigtige Electron-app med materiale læst fra repositoryets gemte version og lokale udbydersvar: adresse, logintrin, arbejdsområde, gennemgang, kildepakke, status, Åbn Promte og projektets statuslinje. Der er ikke udført en rigtig Promte-loginprøve eller upload. Appens samlede afprøvning dokumenteres i [teststatus](teststatus.md).
