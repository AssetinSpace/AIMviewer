import { describe, expect, it } from "vitest";

import {
  COLUMN_RE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  QUERY_OPS,
  clampLimit,
  isUuid,
  sanitizeIfcType,
  sanitizeModelName,
  sanitizeQuery,
} from "./sanitize";

describe("sanitizeQuery (PostgREST or=/ilike injection guard)", () => {
  it("odstráni PostgREST syntax znaky , ( ) %", () => {
    expect(sanitizeQuery("dvere,object_ref.ilike.%x%")).toBe("dvere object_ref.ilike. x");
    expect(sanitizeQuery("a(b)c")).toBe("a b c");
  });

  it("neprepustí or= breakout ako celok", () => {
    const out = sanitizeQuery("x%,id.eq.123)or(name.neq.");
    expect(out).not.toMatch(/[,()%]/);
  });

  it("skráti vstup na 100 znakov", () => {
    expect(sanitizeQuery("a".repeat(500))).toHaveLength(100);
  });

  it("zvládne nie-string a nullish vstupy", () => {
    expect(sanitizeQuery(undefined)).toBe("");
    expect(sanitizeQuery(null)).toBe("");
    expect(sanitizeQuery(42)).toBe("42");
    expect(sanitizeQuery("   ")).toBe("");
  });

  it("bežný text nechá nedotknutý (vrátane diakritiky)", () => {
    expect(sanitizeQuery("VZT jednotka č. 3")).toBe("VZT jednotka č. 3");
  });
});

describe("clampLimit", () => {
  it("default pri nie-čísle", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit("50")).toBe(DEFAULT_LIMIT);
    expect(clampLimit(NaN)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(Infinity)).toBe(DEFAULT_LIMIT);
  });

  it("clampuje do <1, MAX_LIMIT>", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10_000)).toBe(MAX_LIMIT);
  });

  it("zaokrúhľuje nadol a prepustí platné hodnoty", () => {
    expect(clampLimit(7.9)).toBe(7);
    expect(clampLimit(MAX_LIMIT)).toBe(MAX_LIMIT);
  });
});

describe("isUuid", () => {
  it("akceptuje kanonický UUID (case-insensitive)", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("odmietne skrátené, predĺžené a ne-hex tvary", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-42661417400")).toBe(false);
    expect(isUuid("123e4567-e89b-12d3-a456-4266141740000")).toBe(false);
    expect(isUuid("123e4567e89b12d3a456426614174000")).toBe(false);
    expect(isUuid("zzze4567-e89b-12d3-a456-426614174000")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("sanitizeIfcType / sanitizeModelName (ops URL wire-safety, D-066)", () => {
  it("ifc_type prepustí len alfanumerické znaky", () => {
    expect(sanitizeIfcType("IfcDoor")).toBe("IfcDoor");
    expect(sanitizeIfcType("Ifc-Door;hide:all~x.y")).toBe("IfcDoorhideallxy");
    expect(sanitizeIfcType(null)).toBe("");
  });

  it("model name zahodí oddeľovače ops formátu : ; ~ .", () => {
    expect(sanitizeModelName("ASR model v2")).toBe("ASR model v2");
    expect(sanitizeModelName("a:b;c~d.e")).toBe("abcde");
    expect(sanitizeModelName(undefined)).toBe("");
  });
});

describe("COLUMN_RE (query_view stĺpce a JSONB cesty)", () => {
  it("akceptuje stĺpce a JSONB cesty", () => {
    expect(COLUMN_RE.test("name")).toBe(true);
    expect(COLUMN_RE.test("ifc_type")).toBe(true);
    expect(COLUMN_RE.test("properties->>GlobalId")).toBe(true);
    expect(COLUMN_RE.test("properties->Pset_DoorCommon->>FireRating")).toBe(true);
    expect(COLUMN_RE.test("properties->Pset X->>Kľúč")).toBe(false); // diakritika mimo whitelistu
    expect(COLUMN_RE.test("properties->Pset X->>Key 1.2-a")).toBe(true);
  });

  it("odmietne SQL/PostgREST škodlivé tvary", () => {
    expect(COLUMN_RE.test("name,id")).toBe(false);
    expect(COLUMN_RE.test("name;drop table objects")).toBe(false);
    expect(COLUMN_RE.test("name.eq.x")).toBe(false);
    expect(COLUMN_RE.test("(select 1)")).toBe(false);
    expect(COLUMN_RE.test("1name")).toBe(false);
    expect(COLUMN_RE.test("")).toBe(false);
  });
});

describe("QUERY_OPS", () => {
  it("obsahuje len read-only porovnávacie operátory", () => {
    expect(QUERY_OPS.has("eq")).toBe(true);
    expect(QUERY_OPS.has("ilike")).toBe(true);
    expect(QUERY_OPS.has("cs")).toBe(false);
    expect(QUERY_OPS.has("or")).toBe(false);
    expect(QUERY_OPS.has("not")).toBe(false);
  });
});
