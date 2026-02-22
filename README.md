# gy25.se

En statisk Astro-sajt som presenterar Skolverkets läroplansdata (framför allt GY25) i ett mer lättläst format.

Produktionsdomän: [https://gy25.se](https://gy25.se)

README riktar sig främst till dig som vill köra projektet lokalt, förstå dataflödet eller bidra med förbättringar.

## Nuläge (februari 2026)

- Primärt fokus: GY25 (ämnen och nivåer).
- Extra vy finns för GY11 (relevant under övergångsperioden).
- Jämförelsesidor mellan GY11 och GY25 finns kvar.
- Innehåll hämtas från Skolverkets Syllabus API v1 och sparas som Astro content collections.
- Separata changelog-sidor finns för:
  - innehållsändringar från API (`/andringar/innehall`)
  - webbplatsändringar (`/andringar/webbplats`)

## Teknik

- Astro 5
- Tailwind CSS 3
- Cloudflare-adapter (statiskt bygge)
- Sitemap via `@astrojs/sitemap`

## Krav

- Node.js `>=20.3.0` (rekommenderat: Node 22)
- npm 9+

## Projektstruktur (viktigast)

- `src/pages/gy25/*` - GY25-vyer
- `src/pages/gy11/*` - GY11-vyer
- `src/pages/compare/*` - jämförelsevyer
- `src/pages/andringar/*` - changelog-sidor
- `src/content/gy25-subjects/*` - hämtad GY25-data
- `src/content/gy11-subjects/*` - hämtad GY11-data
- `src/content/site-changelog/*` - webbplatsens changelog-poster
- `src/content/metadata/api-metadata.json` - API-version/status
- `scripts/fetch-skolverket-data.ts` - hämtning + lokal sync
- `scripts/analyze-curriculum-changes.ts` - diff/analysrapporter
- `scripts/state/*` - genererade tillstånds- och rapportfiler
- `docs/*` - planerade framtidsuppdateringar och tekniska TODOs

## Kom igång lokalt

```bash
npm install
npm run dev
```

Byggtest:

```bash
npm run build
```

## Scripts

```bash
# Hämta/synka data från Skolverket
npm run fetch-data

# Skapa full ändringsrapport (använder git diff mot HEAD)
npm run analyze-changes

# Lista ändrade ämnen
npm run subject-list

# Detaljdiff för ett ämne
npm run subject-diff -- gy25 SAKE
npm run subject-diff -- gy25 FYSK
```

## Dataflöde i korthet

1. `fetch-data` hämtar ämneslistor och ämnesdokument för GY11/GY25.
2. JSON-filer i `src/content/*-subjects/` uppdateras endast där förändring finns.
3. Metadata + historik skrivs till `scripts/state/`.
4. `analyze-changes` tar fram pedagogiska och tekniska ändringar per ämne.
5. `/andringar/innehall` visar senaste relevanta ändringar för användare.

## Automatisk uppdatering (GitHub Actions)

- Workflow: `.github/workflows/sync-skolverket-data.yml`
- Körs schemalagt två gånger per dygn samt manuellt via `workflow_dispatch`.
- Flöde:
  1. installerar beroenden
  2. kör `npm run fetch-data`
  3. kör `npm run analyze-changes`
  4. committar endast om datafiler faktiskt har ändrats
- Om repo är kopplat till deploy på `main` triggas ny deploy automatiskt efter commit.

## Bidra

1. Skapa en branch från `main`
2. Gör ändringar och kör minst `npm run build`
3. Öppna PR mot `main`
4. Hantera review-kommentarer och mergea när checks är gröna

Tips: håll gärna kodändringar och stora dataändringar i separata commits för enklare review.

## Planerade uppdateringar

Se `/docs` för planerade förbättringar, till exempel:

- `docs/TODO-skolverket-syllabus-v2.md` - plan för eventuell migrering till API v2
- `docs/TODO-ai-interoperabilitet.md` - plan för bättre AI-interoperabilitet (utan AI-funktioner i tjänsten)

## SEO-principer

- Behåll stabila URL:er (särskilt ämnes- och nivåsidor).
- Undvik att byta slug-struktur i onödan.
- Sitemapen byggs automatiskt i Astro-build.
- Ändringar i innehåll bör uppdatera "senast hämtad"/changelog i stället för att flytta sidor.

## Licens

MIT (`LICENSE`)
