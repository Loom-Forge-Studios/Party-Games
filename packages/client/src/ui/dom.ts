// Minimal DOM-builder helper shared by every screen in packages/client/src/ui.
//
// Deliberately not a framework: this client targets modest hardware (see
// docs/ARCHITECTURE.md's "must run cleanly on an Ubuntu mini PC" guidance
// applies just as much to the browser tab as the server process), so a
// handful of declarative helpers over the real DOM keeps things small and
// fast without a VDOM diff or a build-time template compiler.

export type ElAttrs = Record<string, string | number | boolean | undefined | ((ev: Event) => void)>;
export type ElChild = Node | string | null | undefined | false;

/**
 * Creates a DOM element. Attribute keys starting with "on" (e.g. `onclick`)
 * are wired as addEventListener calls instead of attributes. `value`,
 * `checked`, and `disabled` are set as DOM properties (not attributes) so
 * they behave correctly for form controls; everything else is a plain
 * `setAttribute`. Falsy children (`null`/`undefined`/`false`) are skipped,
 * which keeps conditional children (`isHost && el(...)`) readable at call
 * sites.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: ElChild[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      continue;
    }
    if (key === 'value') {
      (node as unknown as { value: string }).value = String(value);
      continue;
    }
    if (key === 'checked') {
      (node as unknown as { checked: boolean }).checked = Boolean(value);
      continue;
    }
    if (key === 'disabled') {
      (node as unknown as { disabled: boolean }).disabled = Boolean(value);
      continue;
    }
    if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
      else node.removeAttribute(key);
      continue;
    }
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Removes every child of `node`. Used before re-rendering a screen host. */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
