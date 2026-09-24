// copy.ts — putting plain text on the system clipboard.
//
// NOT [src/clipboard.ts](clipboard.ts), which holds a rectangle of pixels for
// the editor's copy/cut/paste and never touches the system clipboard at all.
// Two different things that both reasonably want the word "clipboard"; this one
// is only ever text, and only ever outbound.
//
// Two paths, because one is not enough:
//
//   navigator.clipboard   the real API, but it needs a secure context, so it is
//                         absent over plain http -- which is exactly how this
//                         app is served locally (`python -m http.server`) on
//                         any host that is not localhost.
//   execCommand('copy')   deprecated and clunky, but works there.
//
// Both can fail, and a copy that silently did nothing is worse than one that
// says so, so this reports rather than swallows.

export type CopyOutcome =
  | { readonly ok: true; readonly via: 'clipboard-api' | 'exec-command' }
  | { readonly ok: false; readonly reason: string };

export async function copyText(text: string): Promise<CopyOutcome> {
  if (text === '') return { ok: false, reason: 'nothing to copy' };

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, via: 'clipboard-api' };
    } catch {
      // Denied permission, or not a secure context after all. Fall through.
    }
  }

  return legacyCopy(text);
}

/**
 * The textarea trick.
 *
 * The element has to be in the document and selectable for execCommand to see
 * it, so it cannot simply be `display: none`. It is instead parked off-screen
 * and made invisible to assistive technology, and removed in a `finally` so a
 * throw cannot leave a stray node in the page.
 */
function legacyCopy(text: string): CopyOutcome {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';

  const previous = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    return ok
      ? { ok: true, via: 'exec-command' }
      : { ok: false, reason: 'the browser refused the copy' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  } finally {
    area.remove();
    // Selecting the textarea stole focus; hand it back, or the editor loses the
    // keyboard for no reason the user can see.
    previous?.focus?.();
  }
}
