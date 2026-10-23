# Promte-apps i detaljer

Kontrolleret mod Promte 21. oktober 2026. Den fulde engelske vejledning følger med `@promte/app-upload` og kan uden for Aura lægges i projektet med `npx @promte/app-upload skill`.

## Mindste projekt

```
index.html            valgfri; ellers bruges main.jsx/tsx/js/ts i roden eller i src/
src/main.jsx          pakker appen ind i PromteAppProvider
src/App.jsx
src/*.css
public/               statiske filer, kopieres som de er
functions/<navn>/     valgfrie backend-funktioner; kommer aldrig med i browserkoden
package.json
package-lock.json     kun nødvendig, hvis appen har pakker under dependencies
```

`package.json`:

```json
{
  "name": "min-promte-app",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": {},
  "devDependencies": {
    "@promte/app-library": "^0.1.6",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "vite": "^5.4.10"
  }
}
```

Installér med `npm install --legacy-peer-deps`, så længe app-biblioteket angiver React 18 som peer. Der skal ingen `vite.config.js` til. Vite bygger JSX uden. Promte bygger med Node 22, så brug gerne Node 22 lokalt. Node 20.18 eller nyere virker også.

`src/main.jsx`:

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import { PromteAppProvider } from "@promte/app-library";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PromteAppProvider>
      <App />
    </PromteAppProvider>
  </React.StrictMode>,
);
```

## Regler for byggeriet

- Node 22, React 19.2.8 og Vite med fast konfiguration. Lint, typer og tests køres ikke af Promte, så kør dem selv.
- Afvises: `vite|postcss|tailwind|babel|webpack|rollup.config.*`, `.babelrc`, `.postcssrc`, scripts som `postinstall` og `prebuild` og et `build`-script, der ikke er `vite build` eller `tsc && vite build`.
- `tsconfig.json` må ikke bruge `extends`, `paths`, `baseUrl`, `plugins` eller decorators.
- Versioner skal være eksakte, eller `^`/`~` låst i `package-lock.json`. Kun npm-lockfilen bruges. Ingen tags, URL'er, Git-referencer eller aliaser. Pakker med native kode eller installationsscripts fejler.
- Arbejdsområdet kan kræve, at en administrator godkender hver npm-pakke.
- Kildekoden må højst fylde 20 MiB som ZIP og 50 MiB udpakket med højst 2.000 filer. `.env`-filer, nøgler, `node_modules`, `dist` og arkiver afvises. Kommandolinjeværktøjet udelader dem.
- Den byggede app må højst være 6 MiB og 256 filer.

## App-biblioteket

`usePromte()` giver `ready`, `state` og `error`. `state` er `booting`, `waiting_for_settings`, `waiting_for_token` eller `ready`. Uden for Promte når appen aldrig `ready`. `usePromteModels({ type, configuredOnly })` giver `{ models, loading, error, reload }`. `usePromteClient()` giver klienten:

- `models({ type, configuredOnly })`: modeller med `id`, `label`, `type` og `configured`. Typer er `llm`, `embedding`, `image`, `stt` og `tts`.
- `chatText({ model, messages })` giver svaret som tekst. `messages` er `[{ role: "system" | "user" | "assistant", content }]`. `chatCompletions(...)` giver det fulde svar i OpenAI-format.
- `embeddings.create({ model, input })`.
- `data(scope).ref("a/b")` med `get`, `set`, `update`, `remove` og `push`. `private` er pr. bruger. `public` er fælles, og kun administratorer kan skrive. `get()` giver `null`, når intet er gemt. `update({ "x/y": værdi })` bruger stier under ref'en. `push(værdi)` lægger til en liste og opretter den, hvis den mangler.
- `files(scope)` på nyere Promte-servere: `upload`, `list`, `download` og `remove`.
- `knowledge.search({ query, workspaceId })`.
- `functions.invoke(navn, input)` kalder en backend-funktion.

`usePromteUser()` og `usePromteDarkMode()` giver brugeren og temaet.

## Backend-funktioner

Hver funktion er en mappe `functions/<navn>/` med `function.json`, `index.ts` og eventuelt `tests.json`. `function.json` angiver blandt andet `inputSchema`, `outputSchema`, `connections` og `capabilities`. Handleren er `export default async function (input, ctx)`. `ctx.connections.request(...)` bruger en forbindelse, som en administrator har oprettet, så nøglen bliver på serveren. Funktionerne gennemgås sammen med versionen.

## Typiske fejl

| Besked | Hvad du gør |
| --- | --- |
| `Not signed in` eller 401 | Kør `npx @promte/app-upload login` igen. Login gælder i 30 dage. |
| 403 ved upload | Brugeren skal være administrator i arbejdsområdet. |
| `Custom build configuration is not supported` | Fjern byggekonfigurationen, som beskeden nævner. |
| `requires an exact npm version` | Brug en eksakt version, eller lås den i `package-lock.json`. |
| `is supplied by the fixed Coding runtime` | Flyt react, react-dom eller @promte/app-library til `devDependencies`. |
| `npm package approval required` | En administrator skal godkende pakken. |
| Status `blocked` | Gennemgangen fandt et problem. Se versionen under **Releases** i Promte. |
