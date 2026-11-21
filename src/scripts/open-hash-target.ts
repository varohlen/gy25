/**
 * Öppnar hopfällda <details> runt målet för adressens #hash och scrollar dit,
 * så att länkar som /andringar/innehall/#fysk når rätt ämnespost.
 */
function openHashTarget(): void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;

  let details = target.closest('details');
  while (details) {
    details.open = true;
    details = details.parentElement?.closest('details') ?? null;
  }
  target.scrollIntoView({ block: 'start' });
}

export function initOpenHashTarget(): void {
  openHashTarget();
  window.addEventListener('hashchange', openHashTarget);
}
