export const REGEX_TIMEOUT_MS = 200;
export const MAX_TESTED_TEXT_LENGTH = 4000;
export const MAX_PATTERN_LENGTH = 2000;

export interface PatternEvaluation {
    matched: boolean;
    error?: string;
    timedOut?: boolean;
}

export interface PatternIssue {
    level: "error" | "warning";
    message: string;
}

/**
 * Evaluates one pattern against a list of texts.
 *
 * This function is stringified into a Web Worker, so it must stay fully
 * self-contained: no imports, no module level constants, no helper calls
 * outside its own body.
 */
export function evaluatePatternAgainstTexts(pattern: string, flags: string, texts: readonly string[]): PatternEvaluation {
    const urlCandidatePattern = /https?:\/\/[^\s<>"'`]+/gi;
    const trailingUrlPunctuationPattern = /[),.!?;:\]]+$/;
    const animatedProviderDomains = ["klipy.com", "giphy.com", "tenor.com"];
    const maxTextLength = 4000;

    function isAnimatedProviderUrl(url: string) {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            return animatedProviderDomains.some(domain => hostname === domain || hostname.endsWith("." + domain));
        } catch {
            return false;
        }
    }

    function getAnimatedProviderUrlRanges(text: string) {
        const ranges: { start: number; end: number; }[] = [];
        for (const match of text.matchAll(urlCandidatePattern)) {
            const candidate = match[0];
            const trailingPunctuation = candidate.match(trailingUrlPunctuationPattern)?.[0] ?? "";
            const url = trailingPunctuation ? candidate.slice(0, -trailingPunctuation.length) : candidate;
            if (!isAnimatedProviderUrl(url)) continue;
            ranges.push({ start: match.index, end: match.index + url.length });
        }
        return ranges;
    }

    function maskTextRanges(text: string, ranges: { start: number; end: number; }[]) {
        let result = "";
        let cursor = 0;
        for (const range of ranges) {
            result += text.slice(cursor, range.start);
            result += " ".repeat(range.end - range.start);
            cursor = range.end;
        }
        return result + text.slice(cursor);
    }

    function hasMeaningfulTextOutsideRanges(text: string, start: number, end: number, ranges: { start: number; end: number; }[]) {
        let cursor = start;
        let intersectsBlockedRange = false;
        let remainder = "";
        for (const range of ranges) {
            const overlapStart = Math.max(start, range.start);
            const overlapEnd = Math.min(end, range.end);
            if (overlapStart >= overlapEnd) continue;
            intersectsBlockedRange = true;
            if (cursor < overlapStart) remainder += text.slice(cursor, overlapStart);
            cursor = Math.max(cursor, overlapEnd);
        }
        if (!intersectsBlockedRange) return true;
        if (cursor < end) remainder += text.slice(cursor, end);
        return /[\p{L}\p{N}\p{S}]/u.test(remainder);
    }

    function matchesText(text: string, regex: RegExp) {
        const blockedRanges = getAnimatedProviderUrlRanges(text);
        if (blockedRanges.length === 0) return regex.test(text);

        const searchRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
        let neutralizedText: string | undefined;
        let match: RegExpExecArray | null;
        while ((match = searchRegex.exec(text)) != null) {
            const start = match.index;
            if (match[0].length === 0) {
                neutralizedText ??= maskTextRanges(text, blockedRanges);
                const neutralRegex = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""));
                if (neutralRegex.test(neutralizedText)) return true;
                searchRegex.lastIndex++;
                continue;
            }
            if (hasMeaningfulTextOutsideRanges(text, start, start + match[0].length, blockedRanges)) return true;
        }
        return false;
    }

    let regex: RegExp;
    try {
        regex = new RegExp(pattern, flags);
    } catch (error) {
        return { matched: false, error: String(error instanceof Error ? error.message : error) };
    }

    for (const rawText of texts) {
        if (typeof rawText !== "string" || rawText.length === 0) continue;
        const text = rawText.length > maxTextLength ? rawText.slice(0, maxTextLength) : rawText;
        if (matchesText(text, regex)) return { matched: true };
    }
    return { matched: false };
}

const nestedQuantifierPattern = /\([^()]*(?:[*+]|\{\d*,?\d*\})[^()]*\)(?:[*+]|\{\d*,?\d*\})/;

export function inspectPattern(pattern: string, flags: string): PatternIssue[] {
    const issues: PatternIssue[] = [];
    if (!pattern) return issues;

    if (pattern.length > MAX_PATTERN_LENGTH) {
        issues.push({ level: "warning", message: `Pattern is longer than ${MAX_PATTERN_LENGTH} characters and will be rejected.` });
        return issues;
    }

    try {
        new RegExp(pattern, flags);
    } catch (error) {
        issues.push({ level: "error", message: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}` });
        return issues;
    }

    if (nestedQuantifierPattern.test(pattern)) {
        issues.push({
            level: "warning",
            message: "Nested quantifier detected (a repeated group that itself repeats). This can freeze Discord on a single hostile message. Matching is capped by a timeout, but consider simplifying the pattern."
        });
    }

    return issues;
}

interface GuardJob {
    pattern: string;
    flags: string;
    texts: readonly string[];
}

function buildWorkerSource() {
    return `
const evaluatePatternAgainstTexts = ${evaluatePatternAgainstTexts.toString()};
self.onmessage = event => {
    const data = event.data || {};
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const results = jobs.map(job => {
        const outcome = evaluatePatternAgainstTexts(job.pattern, job.flags, job.texts);
        return { matched: !!outcome.matched, error: outcome.error };
    });
    self.postMessage({ id: data.id, results });
};
`;
}

export class RegexWorkerGuard {
    private worker: Worker | undefined;
    private objectUrl: string | undefined;
    private nextId = 0;
    private pending = new Map<number, (results: PatternEvaluation[]) => void>();

    private ensureWorker(): Worker | undefined {
        if (this.worker) return this.worker;
        if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") return undefined;

        try {
            this.objectUrl = URL.createObjectURL(new Blob([buildWorkerSource()], { type: "text/javascript" }));
            const worker = new Worker(this.objectUrl);
            worker.onmessage = event => {
                const data = event.data ?? {};
                const resolve = this.pending.get(data.id);
                if (!resolve) return;
                this.pending.delete(data.id);
                resolve(Array.isArray(data.results) ? data.results : []);
            };
            worker.onerror = () => this.dispose();
            this.worker = worker;
            return worker;
        } catch {
            this.dispose();
            return undefined;
        }
    }

    dispose() {
        const worker = this.worker;
        this.worker = undefined;
        const pending = [...this.pending.values()];
        this.pending.clear();
        for (const resolve of pending) resolve([]);
        try {
            worker?.terminate();
        } catch { }
        if (this.objectUrl) {
            try {
                URL.revokeObjectURL(this.objectUrl);
            } catch { }
            this.objectUrl = undefined;
        }
    }

    async run(jobs: readonly GuardJob[], timeoutMs = REGEX_TIMEOUT_MS): Promise<PatternEvaluation[]> {
        if (jobs.length === 0) return [];

        const worker = this.ensureWorker();
        if (!worker) return jobs.map(job => evaluatePatternAgainstTexts(job.pattern, job.flags, job.texts));

        const id = ++this.nextId;
        const outcome = await new Promise<PatternEvaluation[] | null>(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                this.dispose();
                resolve(null);
            }, timeoutMs);

            this.pending.set(id, results => {
                clearTimeout(timer);
                resolve(results);
            });

            try {
                worker.postMessage({ id, jobs: jobs.map(job => ({ pattern: job.pattern, flags: job.flags, texts: job.texts })) });
            } catch {
                clearTimeout(timer);
                this.pending.delete(id);
                resolve(null);
            }
        });

        if (Array.isArray(outcome) && outcome.length === jobs.length) return outcome;
        return jobs.map(() => ({ matched: false, timedOut: true }));
    }
}

export const regexWorkerGuard = new RegexWorkerGuard();
