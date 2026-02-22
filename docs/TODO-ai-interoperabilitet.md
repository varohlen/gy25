# TODO: Förbättra AI-interoperabilitet (utan AI-funktioner på sajten)

Skapad: 2026-02-22  
Status: Planerad

## Syfte
Göra gy25.se enklare för externa AI-agenter och verktyg att läsa korrekt, citera rätt och förstå datakällans färskhet.

## Princip
Inga AI-funktioner i själva tjänsten. Fokus ligger på struktur, metadata och maskinläsbarhet.

## Planerade förbättringar
1. Publicera stabila JSON-endpoints för ämne/nivå.
2. Inkludera provenance i varje resurs:
   - källa (Skolverket)
   - apiVersion
   - apiReleased
   - syncedAt
   - modifiedDate
3. Lägga till `llms.txt`/`llms-full.txt` med tydlig canonical-vägledning.
4. Publicera innehålls-changelog som maskinläsbar JSON-feed.
5. Fortsätta hålla canonical/redirects konsekventa (minskar felhämtning).
6. Behålla semantisk HTML-struktur (rubriker, listor, tydlig metadata).
7. Versionsmarkera dataformat (`schemaVersion`) för bakåtkompatibilitet.
8. Tydlig användningsnotis: formella beslut ska alltid verifieras mot Skolverket.

## Förväntad nytta
- Färre feltolkningar av GY11/GY25.
- Bättre citerbarhet och spårbarhet.
- Mindre skrapning av HTML när samma data kan hämtas strukturerat.
