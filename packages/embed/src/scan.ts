/**
 * DOM scanning for the embed bundle.
 *
 * Two responsibilities:
 *
 *  1. `readScriptConfig()` — extracts `data-questkit-*` attributes from the
 *     `<script>` element that loaded this bundle. We capture
 *     `document.currentScript` at module init (top-level in `index.ts`) and
 *     pass that reference here, because by the time `DOMContentLoaded`
 *     fires `currentScript` is null.
 *
 *  2. `scanWidgets()` — finds all `[data-questkit="<widget>"]` elements
 *     and packages them as mount descriptors with widget-specific props
 *     parsed from `data-questkit-prop-*` attributes (kebab → camelCase).
 *
 * Both functions are deliberately defensive — invalid input becomes empty
 * results rather than thrown errors, because errors bubbling out of an
 * embed script can break the host page's own JS.
 */

export interface ScriptConfig {
  appId: string;
  userId: string;
  baseUrl: string;
}

export interface WidgetDescriptor {
  el: HTMLElement;
  widget: string;
  props: Record<string, string>;
}

/**
 * Read `data-questkit-app-id` / `-user-id` / `-base-url` from the script
 * tag that loaded the bundle.
 *
 * If `scriptEl` is null (test env, or the host injected the bundle
 * dynamically without a script tag) we return null — `index.ts` will warn
 * and skip auto-init.
 */
export function readScriptConfig(
  scriptEl: HTMLScriptElement | null,
): ScriptConfig | null {
  if (scriptEl === null) return null;
  const appId = scriptEl.getAttribute("data-questkit-app-id");
  const userId = scriptEl.getAttribute("data-questkit-user-id");
  const baseUrl = scriptEl.getAttribute("data-questkit-base-url");

  if (
    appId === null ||
    appId.length === 0 ||
    userId === null ||
    userId.length === 0 ||
    baseUrl === null ||
    baseUrl.length === 0
  ) {
    return null;
  }
  return { appId, userId, baseUrl };
}

/**
 * Convert `data-questkit-prop-foo-bar` to `fooBar`. Standard kebab-to-camel.
 */
function kebabPropToCamel(name: string): string {
  return name
    .toLowerCase()
    .split("-")
    .map((part, idx) =>
      idx === 0
        ? part
        : part.length === 0
          ? ""
          : part[0]!.toUpperCase() + part.slice(1),
    )
    .join("");
}

/**
 * Pull `data-questkit-prop-*` attrs off an element into a camelCased prop
 * record. Returns an empty object when no such attrs exist.
 */
function readPropAttrs(el: HTMLElement): Record<string, string> {
  const props: Record<string, string> = {};
  const PREFIX = "data-questkit-prop-";
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith(PREFIX)) continue;
    const rawKey = attr.name.slice(PREFIX.length);
    if (rawKey.length === 0) continue;
    const key = kebabPropToCamel(rawKey);
    props[key] = attr.value;
  }
  return props;
}

/**
 * Find all `[data-questkit="<widget>"]` elements under `root` and return
 * mount descriptors. Elements without a widget name (empty `data-questkit`)
 * are skipped.
 */
export function scanWidgets(root: ParentNode = document): WidgetDescriptor[] {
  const nodes = root.querySelectorAll<HTMLElement>("[data-questkit]");
  const out: WidgetDescriptor[] = [];
  for (const el of Array.from(nodes)) {
    const widget = el.getAttribute("data-questkit");
    if (widget === null || widget.length === 0) continue;
    out.push({ el, widget, props: readPropAttrs(el) });
  }
  return out;
}
