# TODO: Förbered migrering till Skolverket Syllabus API v2

Skapad: 2026-02-21
Status: Parkerad (ingen produktion-migrering ännu)

## Bakgrund
Skolverket har publicerat en ny API-serie `2.0.0 alpha` / `2.0.0.4 alpha`.
Alpha-versioner kan innehålla icke bakåtkompatibla ändringar.

Nuvarande produktion på gy25.se använder v1-flödet och ska fortsätta göra det tills vidare.

## Mål
Migrera säkert utan att riskera SEO, URL-struktur eller innehållskvalitet.

## Plan (när detta tas upp igen)
1. Lägg till adapter-stöd i fetch-scriptet (`provider: v1 | v2`).
2. Kör v2 i shadow mode (bara rapport/diff, skriv inte content-filer).
3. Jämför v1 vs v2 för:
   - ämneskoder
   - nivåer/kurser
   - centralt innehåll
   - betygskriterier
   - datum-/versionsfält
4. Logga schemaavvikelser och saknade fält.
5. Besluta om produktionsbyte först efter flera stabila körningar.

## Krav innan byte i produktion
- Inga brutna routes eller slug-förändringar.
- Samma eller bättre datatäckning som v1.
- Changelog och diff-visning fungerar fortsatt.
- Full backup av innehåll före byte.

## Referenser
- https://www.skolverket.se/om-skolverket/webbplatser-och-tjanster/oppna-data/api-for-laroplaner-kurs--och-amnesplaner-syllabus
- https://api.skolverket.se/syllabus/swagger-ui/index.html?urls.primaryName=2.1+%C3%84mnen+version+2.0.0+(alpha)
