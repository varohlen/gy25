/**
 * Bakgrundsfärger för ämneskort och ämnesrubriker efter ämnets kategori.
 * Klasserna skrivs ut i sin helhet så att Tailwind hittar dem.
 */
type Categories = { name: string }[] | undefined;

function hasCategory(categories: Categories, name: string) {
  return (categories ?? []).some((c) => c.name.toLowerCase() === name);
}

/** GY25: yrkesämne blått, vissa ämne orange, övriga gröna. */
export function gy25SubjectBg(categories: Categories, { hover = false } = {}) {
  if (hasCategory(categories, 'yrkesämne')) return hover ? 'bg-blue-50 hover:bg-blue-100' : 'bg-blue-50';
  if (hasCategory(categories, 'vissa ämne')) return hover ? 'bg-orange-50 hover:bg-orange-100' : 'bg-orange-50';
  return hover ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-emerald-50';
}

/** GY11: yrkesämne blått, övriga grå. */
export function gy11SubjectBg(categories: Categories) {
  return hasCategory(categories, 'yrkesämne') ? 'bg-blue-50 hover:bg-blue-100' : 'bg-slate-50 hover:bg-slate-100';
}
