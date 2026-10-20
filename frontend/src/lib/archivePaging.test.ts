import { describe, it, expect } from "vitest";
import {
  ARCHIVE_PAGE_SIZE,
  archivePageRoute,
  normalizePage,
  pageCount,
  sliceForPage,
} from "./archivePaging.js";

describe("pageCount", () => {
  it("is 1 for an empty archive, so there is always a page to serve", () => {
    expect(pageCount(0)).toBe(1);
  });

  it("does not open a second page at exactly one page worth of entries", () => {
    expect(pageCount(ARCHIVE_PAGE_SIZE)).toBe(1);
    expect(pageCount(ARCHIVE_PAGE_SIZE + 1)).toBe(2);
  });
});

describe("archivePageRoute", () => {
  it("never emits /arquivo/1/, which would be the same list at a second URL", () => {
    expect(archivePageRoute(1)).toBe("/arquivo/");
    expect(archivePageRoute(0)).toBe("/arquivo/");
    expect(archivePageRoute(2)).toBe("/arquivo/2/");
  });
});

describe("normalizePage", () => {
  it("clamps a hand-typed page into range instead of rendering nothing", () => {
    expect(normalizePage("99", 10)).toBe(1);
    expect(normalizePage("0", 100)).toBe(1);
    expect(normalizePage("-4", 100)).toBe(1);
    expect(normalizePage("abc", 100)).toBe(1);
    expect(normalizePage(undefined, 100)).toBe(1);
    expect(normalizePage("2", 100)).toBe(2);
  });
});

describe("sliceForPage", () => {
  it("partitions without gap or overlap", () => {
    const entries = Array.from({ length: 71 }, (_, index) => index);
    const pages = [1, 2, 3].map((page) => sliceForPage(entries, page));
    expect(pages.flat()).toEqual(entries);
    expect(pages.map((page) => page.length)).toEqual([30, 30, 11]);
  });
});
