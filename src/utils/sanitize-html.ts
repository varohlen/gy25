/**
 * Allowlist-baserad sanering av HTML från Skolverkets API.
 *
 * Används både vid hämtning (scripts/fetch-skolverket-data.ts) och vid
 * rendering (set:html), så att även redan sparade filer skyddas.
 *
 * Garanti: utdata innehåller bara `<` som början på en tillåten tagg utan
 * attribut, som saneraren själv skriver ut. All övrig `<` escapas till `&lt;`.
 */

/** Taggar som förekommer i API-datan och som får passera (utan attribut). */
const ALLOWED_TAGS = new Set([
  'h2', 'h3', 'h4', 'h5',
  'p', 'em', 'i', 'strong',
  'ul', 'ol', 'li',
  'span', 'br', 'italic',
]);

/** Taggar vars innehåll tas bort tillsammans med taggen. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'object',
  'textarea', 'title', 'xmp', 'noembed', 'noframes', 'svg', 'math',
]);

const TAG_PATTERN = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>/;

export function sanitizeHtml(html: string): string {
  let out = '';
  let i = 0;
  const length = html.length;

  while (i < length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    i = lt;
    const rest = html.slice(i);

    // Kommentarer: <!-- ... -->
    if (rest.startsWith('<!--')) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }

    // Doctype, CDATA och processing instructions: <!...> och <?...>
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      const end = html.indexOf('>', i + 2);
      i = end === -1 ? length : end + 1;
      continue;
    }

    const match = TAG_PATTERN.exec(rest);
    if (!match) {
      // Fristående "<" som inte inleder en tagg.
      out += '&lt;';
      i += 1;
      continue;
    }

    const [whole, slash, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    i += whole.length;

    if (!slash && DROP_WITH_CONTENT.has(name)) {
      const closing = new RegExp(`</${name}[\\s/>]`, 'i');
      const found = closing.exec(html.slice(i));
      if (!found) {
        i = length;
      } else {
        const closeStart = i + found.index;
        const closeEnd = html.indexOf('>', closeStart);
        i = closeEnd === -1 ? length : closeEnd + 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) {
      continue;
    }

    if (slash) {
      out += `</${name}>`;
    } else if (name === 'br' && /\/\s*$/.test(attrs)) {
      out += '<br />';
    } else {
      out += `<${name}>`;
    }
  }

  return out;
}

/** Hjälpfunktion för `set:html`: tål saknade värden. */
export function safeHtml(html: string | null | undefined): string {
  return typeof html === 'string' ? sanitizeHtml(html) : '';
}
