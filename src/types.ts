// OK/NO_TECH_DETECTED both mean "we fetched the page fine." Everything else
// means the check didn't complete as intended — kept apart from NO_TECH_DETECTED
// so a caller never mistakes "the site blocked us" for "this site runs on
// nothing we recognize," which is the exact false-negative naive detectors give.
export type DetectStatus = 'OK' | 'NO_TECH_DETECTED' | 'UNREACHABLE' | 'BLOCKED' | 'INVALID_INPUT';

export interface DetectedTechnologyOutput {
    [key: string]: unknown;
    name: string;
    category: string;
    confidence: number;
    evidence: string;
}

export interface DetectStackResult {
    [key: string]: unknown;
    input: string;
    finalUrl: string | null;
    httpStatus: number | null;
    status: DetectStatus;
    technologies: DetectedTechnologyOutput[];
    categoriesSummary: Record<string, number>;
}

export interface BulkDetectSummary {
    total: number;
    ok: number;
    no_tech: number;
    unreachable: number;
    blocked: number;
    invalid_input: number;
}

export interface BulkDetectResult {
    [key: string]: unknown;
    results: DetectStackResult[];
    summary: BulkDetectSummary;
}
