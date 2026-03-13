import { CustomTool, IntentMatch, IntentResponse, ToolListItem } from "../types.js";

const MAX_TOOLS_TO_SCAN = 150;

export function matchIntent(query: string, tools: CustomTool[]): IntentResponse {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) {
        return { query, matches: [] };
    }

    // Cap to most recently updated tools to bound scan time on large tool sets
    const toolsToScan = tools.length > MAX_TOOLS_TO_SCAN
        ? [...tools].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, MAX_TOOLS_TO_SCAN)
        : tools;

    const matches: IntentMatch[] = [];

    for (const tool of toolsToScan) {
        let score = 0;
        const matchedTerms: string[] = [];

        for (const term of terms) {
            let termScore = 0;
            let matched = false;

            if (tool.name.toLowerCase().includes(term)) {
                termScore += 4;
                matched = true;
            }
            if (tool.description.toLowerCase().includes(term)) {
                termScore += 3;
                matched = true;
            }
            if (tool.tags?.some(tag => tag.toLowerCase().includes(term))) {
                termScore += 2;
                matched = true;
            }
            if (tool.category?.toLowerCase().includes(term)) {
                termScore += 1;
                matched = true;
            }

            if (matched) {
                score += termScore;
                matchedTerms.push(term);
            }
        }

        if (score > 0) {
            const multiTermBonus = matchedTerms.length > 1 ? (matchedTerms.length - 1) * 0.2 : 0;
            const finalScore = score * (1 + multiTermBonus);

            const maxPossiblePerTerm = 10;
            const confidence = Math.min(finalScore / (terms.length * maxPossiblePerTerm), 1.0);

            const match = {
                tool: {
                    name: tool.name,
                    description: tool.description,
                    version: tool.version,
                    createdAt: tool.createdAt,
                    updatedAt: tool.updatedAt,
                    capabilities: tool.capabilities,
                    category: tool.category,
                    tags: tool.tags,
                    deprecated: tool.deprecated
                },
                score: finalScore,
                confidence,
                matchedTerms
            };

            // Early-exit: a near-perfect match means no need to scan further
            if (confidence >= 0.95) {
                return { query, matches: [match] };
            }

            matches.push(match);
        }
    }

    matches.sort((a, b) => b.score - a.score);

    const result: IntentResponse = {
        query,
        matches: matches.slice(0, 10)
    };

    if (matches.length > 0 && matches[0].confidence < 0.6) {
        const top3 = matches.slice(0, 3).map(m => m.tool.name);
        if (top3.length >= 2) {
            result.suggestions = [
                `No single tool matches perfectly. Consider composing: ${top3.join(" and ")}`
            ];
        }
    }

    return result;
}
