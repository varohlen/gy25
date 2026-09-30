# AGENTS.md: Projektinstruktioner för gy25.se

gy25.se är en statisk webbplats som gör Skolverkets läroplansdata lättare att läsa,
med GY25-ämnen och nivåer, GY11-kurser och jämförelser mellan systemen.
Produktionsdomänen är https://gy25.se. Bygget använder Cloudflare-adapter;
Cloudflare-projektnamn och deploy-skript finns inte angivna i repot.

## Verktyg

Använd npm och `package-lock.json`. Node.js måste vara `>=20.3.0`;
`.node-version` anger 22, medan GitHub Actions använder Node 20.
Kör kommandona från repots rot eftersom dataskripten använder `process.cwd()`.

```bash
npm ci                                              # Installera från låsfilen
npm run dev                                         # Lokal utveckling
npm run build                                       # Statiskt bygge till dist/
npm run preview                                     # Förhandsvisa bygget
npm run astro -- check                              # Separat typkontroll
npm run fetch-data                                  # Synka Skolverkets data
npm run analyze-changes                             # Skriv ändringsrapport
npm run subject-list -- --version gy25 --level high  # Lista stor påverkan
npm run subject-diff -- --version gy25 --code FYSK   # Skriv ämnesdiff
```

`package.json` har inga test- eller lint-skript. README anger `npm run build`
som minsta kontroll före PR; byggkommandot kör inte `astro check`.

## Stack

- Astro 5 med `output: 'static'`, `@astrojs/cloudflare` och automatisk sitemap.
- TypeScript med `astro/tsconfigs/strict`; aliaset `@/*` pekar på `src/*`.
- Tailwind CSS 3. Rubriker använder Lexend och brödtext Inter.
- Läroplansdata lagras som JSON i Astro content collections med Zod-scheman.

## Struktur

```text
src/
├── pages/{gy25,gy11,compare}/    Ämnen, nivåer/kurser och jämförelser
├── pages/andringar/             Innehålls- och webbplatschangelog
├── components/                 Ämnes-/kursvyer och jämförelsekomponenter
├── layouts/                    Gemensamma och versionsspecifika layouter
├── content/config.ts           Scheman för collections
├── content/{gy25-subjects,gy11-subjects}/  Hämtad läroplansdata
├── content/metadata/            API-version och status
├── content/site-changelog/      Webbplatsens changelog-poster i JSON
└── utils/changelog.ts           Läser rapporter/historik vid byggtid
scripts/
├── fetch-skolverket-data.ts     Synk från Syllabus API v1
├── analyze-curriculum-changes.ts  Analys mot git HEAD
└── state/                      Versionshanterade rapporter och historik
.github/workflows/sync-skolverket-data.yml  Schemalagd datasynk
docs/                           Planer för API v2 och AI-interoperabilitet
```

## Arbetsflöde och konventioner

- Bevara URL-strukturen. Ämnes- och kurskoder blir gemener i genererade URL:er.
- GY25-nivåer använder fortfarande fältet `courses` och parametern `[courseCode]`.
- Uppdatera läroplansdata via `fetch-data`; synken hämtar nya ämnen och ämnen med
  ändrat `modifiedDate`, och tar bort lokala ämnesfiler som saknas i API-listan.
- Kör `analyze-changes` efter datasynk och före commit. Rapporten jämför
  arbetskatalogen med `HEAD` och skriver till `scripts/state/`.
- Webbplatsändringar dokumenteras i `src/content/site-changelog/` enligt schemat
  i `src/content/config.ts`. API-historik kommer från datasynkens tillståndsfiler.
- Datasynkens workflow körs 05:15 och 17:15 UTC samt manuellt. Det synkar,
  analyserar och committar/pushar ändrade data- och rapportfiler till körningens branch.

## Gotchas

- README:s positionella exempel för `subject-diff` fungerar inte med skriptets
  argumenttolkning. Använd `--version` och `--code` som i kommandot ovan.
- `subject-list` läser befintlig rapport om den finns; standardfilter är
  `--version gy25 --level medium`. Kör analysen igen för att få aktuell rapport.
- `SKOLVERKET_GY25_DATE` styr datumurval för GY25 vid hämtning. Utan variabeln
  används `timespan=LATEST`. API v2 i `docs/` är en plan, inte nuvarande datakälla.
- `scripts/state/` används även av webbplatsen vid byggtid, inte bara av CLI-verktyg.
- `tsconfig.json` undantar `src/components/gy11course.astro` och
  `src/components/gy11subject.astro` från projektets TypeScript-inkludering.

## Linear

Ärenden för detta repo ligger i Linear-teamet VIK, projektet "gy25.se". Använd befintliga etiketter (t.ex. Innehåll, Bug, Feature, Improvement, Interaktivitet, Bedömning, Bilder/R2, Källor, Beslut, Plattform). Skapa inte nya projekt eller etiketter utan att fråga.
