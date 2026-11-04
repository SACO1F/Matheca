import { expect, it } from "vitest";
import catalog from "../src/shared/catalog-data.json";
import fixtures from "../src/shared/normalization-fixtures.json";
import {
  groups,
  grades,
  kinds,
  difficulties,
  normalizeKnowledge,
} from "../src/domain/catalog";
import { cleanBody, cleanTitle } from "../src/domain/math";
it("keeps the Rust catalog synchronized with the existing domain", () => {
  expect(catalog.groups).toEqual(groups);
  expect(catalog.grades).toEqual(grades);
  expect(catalog.kinds).toEqual(kinds);
  expect(catalog.difficulties).toEqual(difficulties);
  for (const [alias, point] of Object.entries(catalog.aliases))
    expect(normalizeKnowledge(alias)).toBe(point);
});
it("keeps the Rust normalization corpus synchronized with TypeScript", () => {
  for (const fixture of fixtures) {
    expect(cleanTitle(fixture.input)).toBe(fixture.title);
    expect(cleanBody(fixture.input)).toBe(fixture.body);
  }
});
