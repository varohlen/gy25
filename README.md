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

- Node.js `^22.22.2 || >=24.15.0` (rekommenderat: Node 24 enligt `.node-version`). Kravet kommer från pnpm 12.
- pnpm (version enligt `packageManager` i package.json, aktiveras med `corepack enable`)

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
pnpm install
pnpm dev
```

Byggtest, typkontroll och enhetstester:

```bash
pnpm build
pnpm check
pnpm test
```

## Scripts

```bash
# Hämta/synka data från Skolverket
pnpm fetch-data

# Skapa full ändringsrapport (använder git diff mot HEAD)
pnpm analyze-changes

# Lista ändrade ämnen
pnpm subject-list

# Detaljdiff för ett ämne
pnpm subject-diff -- --version gy25 --code SAKE
pnpm subject-diff -- --version gy25 --code FYSK
```

## Dataflöde i korthet

1. `fetch-data` hämtar ämneslistor och ämnesdokument för GY11/GY25.
2. JSON-filer i `src/content/*-subjects/` uppdateras endast där förändring finns.
3. Metadata + historik skrivs till `scripts/state/`.
4. `analyze-changes` tar fram pedagogiska och tekniska ändringar per ämne.
5. `/andringar/innehall` visar senaste relevanta ändringar för användare.
6. Varje innehållsuppdatering får en beständig detaljrapport i
   `scripts/state/change-reports/`. Historiken länkar till rapportens egen sida
   med alla berörda ämnen och ändringsdetaljer. Synkar utan innehållsändringar
   uppdaterar kontrollstatusen utan att skapa en ny historikpost.

Regressionstest för rapportarkivet (simulerat API och isolerat git-repo) körs
med övriga tester via `pnpm test`, eller separat:

```bash
node --import tsx --test scripts/tests/change-history.test.ts
```

## Uppdatering av data (manuell, med påminnelse)

Datan uppdateras manuellt. En schemalagd uppgift på servern kör en kontroll
och påminner när Skolverket har ändrat något. Kontrollen skriver ingenting:

```bash
pnpm check-updates          # text; exit 0 = aktuell, 2 = ändringar finns, 1 = fel
pnpm check-updates --json   # samma resultat som JSON
```

När kontrollen visar ändringar:

1. Skapa en branch från `main`.
2. Kör `pnpm fetch-data` och sedan `pnpm analyze-changes`.
3. Granska diffen och `scripts/state/change-impact-report.md`.
4. Kör `pnpm build`, committa data- och rapportfiler och öppna en PR.
5. Mergea till `main` (Cloudflare Pages publicerar) och kontrollera gy25.se.

Tidigare fanns ett GitHub Actions-workflow som synkade automatiskt. Det
misslyckades i varje körning med ändringar (`git pull --rebase` kördes efter
att filerna skrivits) och är borttaget.

## Bidra

1. Skapa en branch från `main`
2. Gör ändringar och kör minst `pnpm build` och `pnpm test`
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
