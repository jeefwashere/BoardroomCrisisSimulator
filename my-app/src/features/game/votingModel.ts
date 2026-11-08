// Pure helpers for the voting panel. Ballots of other members stay private: the
// server only reports the caller's own vote and, once voting closes, the tally.

/** Options as the server sends them; kind and member_id are present but optional in the typed snapshot. */
export type ChoiceOption = {
    option_id: string
    label: string
    kind?: string
    member_id?: string | null
    description?: string | null
    rationale?: string | null
}

export type TallyRow = { option_id: string; label: string; count: number; share: number; leading: boolean }

export type BallotProgress = { cast: number; eligible: number; share: number }

export function ballotProgress(counts: Record<string, number> | null | undefined, eligible: number): BallotProgress | null {
    if (!counts) return null
    const cast = Object.values(counts).reduce((total, count) => total + count, 0)
    return { cast, eligible, share: eligible > 0 ? Math.min(1, cast / eligible) : 0 }
}

/** Rows for tally bars, or null when an option label is unknown (never expose raw option IDs). */
export function tallyRows(counts: Record<string, number> | null | undefined, labels: Record<string, string>): TallyRow[] | null {
    if (!counts) return null
    const entries = Object.entries(counts)
    if (entries.length === 0 || entries.some(([id]) => !labels[id])) return null
    const total = entries.reduce((sum, [, count]) => sum + count, 0)
    const high = Math.max(0, ...entries.map(([, count]) => count))
    return entries.map(([id, count]) => ({
        option_id: id,
        label: labels[id],
        count,
        share: total > 0 ? count / total : 0,
        leading: high > 0 && count === high,
    }))
}

export function optionDescription(option: ChoiceOption, memberName: (memberId: string) => string | undefined): string | null {
    if (option.description) return option.description
    if (option.kind === 'custom') {
        const author = option.member_id ? memberName(option.member_id) : undefined
        return author ? `Custom action proposed by ${author}.` : 'Custom action proposed in discussion.'
    }
    return null
}

export function mergeLabels(known: Record<string, string>, options: ChoiceOption[]): Record<string, string> | null {
    return options.some((option) => known[option.option_id] !== option.label)
        ? { ...known, ...Object.fromEntries(options.map((option) => [option.option_id, option.label])) }
        : null
}

/** Status line for agent drafted ballot options, or null when nothing should be shown. */
export function aiOptionsNotice(game: { ballot_source?: string; options_source?: string; ai_options_status?: string } | null | undefined, phase: string): string | null {
    if (!game || game.ballot_source !== 'ai') return null
    const drafting = ['reading', 'speaking', 'discussion'].includes(phase)
    if (drafting) {
        if (game.ai_options_status === 'pending') return 'AI agents are drafting this round\'s voting options from the report and your discussion…'
        if (game.ai_options_status === 'ready') return 'AI agents have drafted the voting options. They may refresh once discussion begins.'
        if (game.ai_options_status === 'failed') return 'AI drafting failed; this round will use the scenario\'s prepared options.'
        return null
    }
    if (phase === 'voting' || phase === 'tie_break') {
        if (game.options_source === 'ai') return 'Options drafted by AI agents (Vertex Gemini). Only members vote.'
        if (game.options_source === 'prepared_fallback') return 'AI options were not ready, so the scenario\'s prepared options are used.'
    }
    return null
}

/** The caller's own custom ballot option this round, if they proposed one. */
export function ownCustomOption(options: readonly ChoiceOption[], selfId: string): ChoiceOption | null {
    return options.find((option) => option.kind === 'custom' && option.member_id === selfId) ?? null
}

/** Badge for custom ballot options, or null for prepared and AI options. */
export function customOptionBadge(option: ChoiceOption, memberName: (memberId: string) => string | undefined, selfId: string): string | null {
    if (option.kind !== 'custom') return null
    if (option.member_id && option.member_id === selfId) return 'Your custom option'
    const author = option.member_id ? memberName(option.member_id) : undefined
    return author ? `Custom · proposed by ${author}` : 'Custom'
}

/** Text to prefill when editing an existing proposal. */
export function proposalDraft(option: ChoiceOption | null, proposals: readonly { option_id: string; text: string }[] | null | undefined): string {
    if (!option) return ''
    return proposals?.find((proposal) => proposal.option_id === option.option_id)?.text ?? option.description ?? option.label
}

/** Status line for the AI mapping of a winning custom option onto an outcome, or null when nothing should be shown. */
export function resolutionNotice(resolution: { status: string; error: string | null } | null | undefined, phase: string): { text: string; tone: 'pending' | 'failed' } | null {
    if (!resolution || !['resolving', 'resolution_failed', 'decision', 'result'].includes(phase)) return null
    if (resolution.status === 'pending') return { text: 'AI is mapping the winning custom option to an outcome…', tone: 'pending' }
    if (resolution.status === 'failed' || resolution.status === 'unresolved' || phase === 'resolution_failed') {
        return { text: `The AI could not map the winning custom option to an outcome${resolution.error ? `: ${resolution.error}` : '.'}`, tone: 'failed' }
    }
    return null
}
