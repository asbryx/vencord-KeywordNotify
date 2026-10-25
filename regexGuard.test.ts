import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePatternAgainstTexts, inspectPattern, MAX_PATTERN_LENGTH, RegexWorkerGuard } from "./regexGuard";

const urlPattern = String.raw`https?:\/\/(?!(?:[^\/\s]+\.)*(?:tenor\.com|giphy\.com)(?:[\/:\s]|$))(?![^\s]*\.gif(?:[?#][^\s]*)?(?:\s|$))[^\s]+`;

test("matches plain text and reports no error", () => {
    assert.deepEqual(evaluatePatternAgainstTexts("keyword", "", ["alpha keyword omega"]), { matched: true });
    assert.deepEqual(evaluatePatternAgainstTexts("keyword", "", ["nothing here"]), { matched: false });
});

test("honours the ignore-case flag", () => {
    assert.equal(evaluatePatternAgainstTexts("KEYWORD", "", ["keyword"]).matched, false);
    assert.equal(evaluatePatternAgainstTexts("KEYWORD", "i", ["keyword"]).matched, true);
});

test("reports an invalid pattern instead of throwing", () => {
    const result = evaluatePatternAgainstTexts("[", "", ["anything"]);
    assert.equal(result.matched, false);
    assert.match(result.error ?? "", /regular expression/i);
});

test("skips non-string and empty texts", () => {
    assert.deepEqual(
        evaluatePatternAgainstTexts("x", "", [undefined as unknown as string, null as unknown as string, "", "x"]),
        { matched: true }
    );
    assert.deepEqual(evaluatePatternAgainstTexts("x", "", [undefined as unknown as string, ""]), { matched: false });
});

test("ignores links hosted on animated providers", () => {
    const tenor = "look https://tenor.com/view/abc-123";
    const giphy = "https://media.giphy.com/media/abc/giphy.gif";
    assert.equal(evaluatePatternAgainstTexts(urlPattern, "", [tenor]).matched, false);
    assert.equal(evaluatePatternAgainstTexts(urlPattern, "", [giphy]).matched, false);
});

test("still matches a normal link next to an animated provider link", () => {
    const text = "https://tenor.com/view/abc-123 and https://example.com/page";
    assert.equal(evaluatePatternAgainstTexts(urlPattern, "", [text]).matched, true);
});

test("caps very long text without changing a match at the start", () => {
    const long = "keyword " + "x".repeat(50_000);
    assert.equal(evaluatePatternAgainstTexts("keyword", "", [long]).matched, true);
});

test("inspectPattern flags the active URL pattern as a nested quantifier risk", () => {
    const issues = inspectPattern(urlPattern, "");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].level, "warning");
    assert.match(issues[0].message, /Nested quantifier/);
});

test("inspectPattern accepts simple patterns", () => {
    for (const pattern of ["keyword", "https?://[^\\s]+", "(foo|bar)+", "\\bWL\\b", "mint|whitelist"]) {
        assert.deepEqual(inspectPattern(pattern, ""), [], pattern);
    }
});

test("inspectPattern reports invalid patterns as errors", () => {
    const issues = inspectPattern("(unclosed", "");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].level, "error");
});

test("inspectPattern rejects oversized patterns", () => {
    const issues = inspectPattern("a".repeat(MAX_PATTERN_LENGTH + 1), "");
    assert.equal(issues[0].level, "warning");
    assert.match(issues[0].message, /longer than/);
});

test("inspectPattern stays quiet for an empty pattern", () => {
    assert.deepEqual(inspectPattern("", ""), []);
});

test("guard falls back to synchronous evaluation when no Worker exists", async () => {
    const guard = new RegexWorkerGuard();
    const results = await guard.run([
        { pattern: "keyword", flags: "", texts: ["alpha keyword omega"] },
        { pattern: "missing", flags: "", texts: ["alpha keyword omega"] }
    ]);
    guard.dispose();

    assert.equal(results[0].matched, true);
    assert.equal(results[1].matched, false);
});

test("guard returns an empty result for no jobs", async () => {
    const guard = new RegexWorkerGuard();
    assert.deepEqual(await guard.run([]), []);
    guard.dispose();
});
