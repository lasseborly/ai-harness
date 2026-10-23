---
name: harness-integration-promte
description: Bygger en app, der kører i et Promte-arbejdsområde og bruger Promtes modeller, vidensbaser og data via app-biblioteket, og udgiver kildekoden med Auras Udgiv eller med Promtes kommandolinjeværktøj. Forklarer byggeregler, login, nøgler og godkendelse. Brug den, når projektet skal blive en Promte-app.
---

# Promte

En Promte-app er en React-app, der kører i en iframe i et arbejdsområde i Promte. Appen bruger organisationens modeller, vidensbaser og datalager gennem npm-pakken `@promte/app-library`. Kildekoden uploades med `@promte/app-upload`, og Promte-serveren tjekker og bygger den.

## Før du bygger

- **Adgang:** Brugeren skal have en Promte-installation og være administrator i appens arbejdsområde. Har brugeren ikke det, så byg og afprøv lokalt med Vite, og skriv en bestilling til IT. Brug skabelonen nederst.
- **Data:** Appen gemmer data i Promte, enten privat for hver bruger eller fælles for arbejdsområdet. Hvilke persondata appen behandler, afhænger af appen. Gem kun det, løsningen har brug for.
- **Hvor data sendes hen:** Appen kalder kun organisationens egen Promte-server. Promte sender modelkald videre til de modeller, organisationen har sat op.

## Projektet

Promte bygger med en fast React- og Vite-opsætning. Detaljer, skabelon og fejlbeskeder står i `references/promte.md`.

- Pak appen ind i `PromteAppProvider`. Kald `usePromte()` og `usePromteClient()` ubetinget øverst i komponenten, og vent på `ready`, før du kalder klientens API. Vis `error`, hvis forbindelsen fejler.
- Hent modeller med `usePromteModels({ type: "llm", configuredOnly: true })`. Hooket venter selv på `ready` og giver `{ models, loading, error }`, hvor `error` er en tekst. Lad brugeren vælge, og skriv aldrig model-id'er fast i koden.
- Tekst fra en model: `await client.chatText({ model, messages })` giver svaret som tekst og kaster en fejl, hvis kaldet fejler. Vis da en fejlbesked på dansk. En besked er `{ role: "system" | "user" | "assistant", content }`. Beder du om JSON, så kontrollér svaret, før du bruger det.
- Tekst fra borgere eller andre kan indeholde instruktioner til modellen. Læg den i en `user`-besked, aldrig i `system`-beskeden, og behandl svaret som data.
- Gem appens data med `client.data("private").ref("sti")`, som tilhører den enkelte bruger. `"public"` deles i arbejdsområdet, og kun administratorer kan skrive der. `set(værdi)` gemmer enhver JSON-værdi, også lister, og `get()` giver den tilbage eller `null`, når intet er gemt. Skal en liste begrænses, fx til de seneste 20, så hent den, forkort den, og gem den med `set`. Gem kun det nødvendige.
- Læg `react`, `react-dom` og `@promte/app-library` under `devDependencies`. Promte leverer selv de versioner, appen bygges med. Installér med `npm install --legacy-peer-deps`, fordi app-biblioteket endnu angiver React 18.
- Lav ingen `vite.config.js`, `tailwind.config.js` eller `postcss.config.js`. Promte bygger med sin egen opsætning, og JSX virker uden. Brug almindelig CSS.
- Andre npm-pakker skal have en fast version eller være låst i `package-lock.json`. Højst 20 pakker.
- Tekst, brugeren skriver, sendes gennem Promte til organisationens modeller. Kan brugeren skrive personoplysninger, fx navne i mødenoter, så sig det i appen, og bed om at udelade det, der ikke er nødvendigt.

## Nøgler

Læg aldrig nøgler, adgangskoder eller tokens i browserkode, chat, logs eller versioner, og læg dem heller ikke i projektets `.env`. Skal appen kalde en anden tjeneste med en nøgle, så brug en backend-funktion i appen og en forbindelse, som en administrator har oprettet i Promte. Nøglen bliver på Promtes server.

Login til udgivelse gemmes krypteret af Aura eller af kommandolinjeværktøjet i brugerens egen mappe, `~/.config/promte/credentials.json`, aldrig i projektet. Bed aldrig brugeren indsætte et token i chatten.

## Udgivelse

**I Aura** udgiver brugeren selv med **Udgiv → Promte Apps**. Aura logger ind i browseren, viser brugerens apps eller opretter en ny og sender den seneste gemte version. Aura gemmer versioner med Git. Kør ikke upload-kommandoer fra Aura, og gem ikke selv en version uden at blive bedt om det. Når appen bygger lokalt, så foreslå, at brugeren gemmer en version i Aura og bruger Udgiv. Fejl fra Promtes bygning vises i Udgiv, så ret dem, og bed brugeren gemme en ny version.

**I andre kodeværktøjer** bruges Promtes kommandolinjeværktøj. Kommandoerne henter en pakke fra npm. Kør dem kun, når brugeren har sagt ja til det.

1. `npx @promte/app-upload login`. Brugeren godkender i browseren. Brug `--host` med organisationens Promte-adresse, hvis den ikke er `https://app.promte.dk`.
2. `npx @promte/app-upload config --host <adresse> --workspaceId <id>`. Brug samme Promte-adresse som ved login. Id'et står i adressen på appens arbejdsområde.
3. `npx @promte/app-upload push`. Fejl i byggeriet vises i terminalen. Ret dem, og upload igen.
4. `npx @promte/app-upload status`. Står versionen til gennemgang, er den nuværende version online, indtil den nye er godkendt.

## Afprøvning

Kontrollér først, at `npx vite build` lykkes. Appen taler kun med Promte, når en Promte-side omkring den svarer. Åbnet direkte i en almindelig browser venter den på `ready`.

- **I Aura:** Start forhåndsvisningen som for andre projekter. Aura svarer som Promte, så appen får rigtige modeller og data. Når Promte-integrationen er slået til, beder Aura første gang brugeren logge ind med Promte og oprette en app med projektets navn. Udgiv bruger samme app senere.
- **I andre værktøjer:** Kør `npm run dev`, åbn appens arbejdsområde i Promte, vælg **Lokal forhåndsvisning til udvikling** under **Forhåndsvisning**, og indtast `http://localhost:5173`. Det kræver administratoradgang til arbejdsområdet.

Appen skal vise, at den er forbundet, og en liste over modeller. Brug opdigtede data, aldrig rigtige borgeres oplysninger.

## Bestilling til IT

Når brugeren mangler adgang, så skriv en kort bestilling med:
- formålet og hvem der skal bruge appen;
- hvilken Promte-installation og hvilket arbejdsområde;
- at brugeren skal være administrator i arbejdsområdet for at uploade versioner;
- hvilke data appen gemmer, og om der er persondata, så databeskyttelsesrådgiveren kan tage stilling;
- hvilke forbindelser til andre systemer appen skal bruge, hvis nogen.
