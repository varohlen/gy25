# GY25 - Utforska den nya gymnasiereformen

En webbapplikation för att utforska och förstå den nya gymnasiereformen GY25. Projektet är byggt med [Astro](https://astro.build) och hämtar data direkt från Skolverkets API.

## Funktioner

- **Ämnesöversikt**: Bläddra genom alla ämnen i GY25
- **Nivåöversikt**: Se alla nivåer (tidigare kurser) listade
- **Sökfunktion**: Sök bland ämnen och nivåer
- **Jämförelse**: Jämför ämnen mellan GY11 och GY25
- **Automatisk uppdatering**: Data hämtas direkt från Skolverket

## Teknisk översikt

Projektet använder följande teknologier:

- [Astro](https://astro.build) - Web framework
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [TypeScript](https://www.typescriptlang.org) - Type safety
- Skolverkets API - Data source

## Utveckling

### Förutsättningar

- Node.js 18 eller senare
- npm

### Installation

1. Klona repot
```bash
git clone https://github.com/varohlen/gy25.git
cd gy25
```

2. Installera dependencies
```bash
npm install
```

3. Starta utvecklingsservern
```bash
npm run dev
```

### Kommandon

| Kommando                  | Funktion                                         |
| :----------------------- | :----------------------------------------------- |
| `npm install`            | Installera dependencies                          |
| `npm run dev`            | Starta utvecklingsserver på `localhost:4321`     |
| `npm run build`          | Bygg produktionsversion till `./dist/`           |
| `npm run preview`        | Förhandsgranska byggd sida lokalt               |
| `npm run fetch-data`     | Uppdatera data från Skolverkets API             |

## Bidra

Bidrag är välkomna! Om du vill bidra:

1. Forka repot
2. Skapa en feature branch (`git checkout -b feature/AmazingFeature`)
3. Committa dina ändringar (`git commit -m 'Add some AmazingFeature'`)
4. Pusha till branchen (`git push origin feature/AmazingFeature`)
5. Öppna en Pull Request

## Licens

Detta projekt är licensierat under MIT License - se [LICENSE](LICENSE) filen för detaljer.

## Skapare

**Viktor Arohlén**

- Webbsida: [arohlen.se](https://arohlen.se)
- GitHub: [@varohlen](https://github.com/varohlen)

## Relaterade projekt

- [Summor.se](https://summor.se) - Sammanfattningar i gymnasiekurser
- [Tallinje.se](https://tallinje.se) - Interaktiv tallinje för matematikundervisning
