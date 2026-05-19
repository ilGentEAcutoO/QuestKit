/**
 * scan.ts — DOM attribute scanning.
 *
 *  - readScriptConfig: extracts app-id / user-id / base-url; returns null
 *    when any required attr is missing.
 *  - scanWidgets: finds all [data-questkit] elements; parses
 *    data-questkit-prop-* kebab attrs to camelCased props; skips
 *    elements whose data-questkit value is empty.
 *
 * Tests build the DOM via `document.createElement` + `setAttribute` rather
 * than innerHTML so the security-lint hook stays happy.
 */
import { readScriptConfig, scanWidgets } from "../src/scan";

function makeEl(
  tag: string,
  attrs: Record<string, string>,
  parent: ParentNode = document.body,
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

describe("readScriptConfig", () => {
  it("returns null when scriptEl is null", () => {
    expect(readScriptConfig(null)).toBeNull();
  });

  it("extracts the three required attributes", () => {
    const script = document.createElement("script");
    script.setAttribute("data-questkit-app-id", "app_123");
    script.setAttribute("data-questkit-user-id", "user_abc");
    script.setAttribute("data-questkit-base-url", "https://api.example.com");

    expect(readScriptConfig(script)).toEqual({
      appId: "app_123",
      userId: "user_abc",
      baseUrl: "https://api.example.com",
    });
  });

  it("returns null when any required attr is missing", () => {
    const script = document.createElement("script");
    script.setAttribute("data-questkit-app-id", "app_123");
    script.setAttribute("data-questkit-user-id", "user_abc");
    // missing base-url
    expect(readScriptConfig(script)).toBeNull();
  });

  it("returns null when an attr is the empty string", () => {
    const script = document.createElement("script");
    script.setAttribute("data-questkit-app-id", "");
    script.setAttribute("data-questkit-user-id", "user_abc");
    script.setAttribute("data-questkit-base-url", "https://api.example.com");
    expect(readScriptConfig(script)).toBeNull();
  });
});

describe("scanWidgets", () => {
  beforeEach(() => {
    while (document.body.firstChild !== null) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("returns empty array when no widgets are present", () => {
    expect(scanWidgets(document)).toEqual([]);
  });

  it("finds elements with a non-empty data-questkit attribute", () => {
    makeEl("div", { "data-questkit": "MissionList" });
    makeEl("div", { "data-questkit": "CoinBalance" });
    makeEl("div", { "data-questkit": "" });
    const out = scanWidgets(document);
    expect(out).toHaveLength(2);
    expect(out[0]!.widget).toBe("MissionList");
    expect(out[1]!.widget).toBe("CoinBalance");
  });

  it("parses data-questkit-prop-* attrs into camelCased props", () => {
    makeEl("div", {
      "data-questkit": "MissionList",
      "data-questkit-prop-campaign-id": "c1",
      "data-questkit-prop-status": "active",
      "data-questkit-prop-limit": "10",
    });
    const out = scanWidgets(document);
    expect(out).toHaveLength(1);
    expect(out[0]!.props).toEqual({
      campaignId: "c1",
      status: "active",
      limit: "10",
    });
  });

  it("collapses multi-segment kebab keys correctly", () => {
    makeEl("div", {
      "data-questkit": "X",
      "data-questkit-prop-very-long-key": "v",
    });
    const out = scanWidgets(document);
    expect(out[0]!.props).toEqual({ veryLongKey: "v" });
  });

  it("scopes scanning to a passed-in root", () => {
    makeEl("div", { "data-questkit": "A" });
    const section = makeEl("section", { id: "scope" });
    makeEl("div", { "data-questkit": "B" }, section);
    const out = scanWidgets(section);
    expect(out).toHaveLength(1);
    expect(out[0]!.widget).toBe("B");
  });
});
