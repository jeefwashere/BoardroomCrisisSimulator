// Pure helpers for the voting panel. Ballots of other members stay private: the
// server only reports the caller's own vote and, once voting closes, the tally.

/** Options as the server sends them; kind and member_id are present but optional in the typed snapshot. */
export type ChoiceOption = {
    option_id: string
    label: string
    kind?: string
    member_id?: string | null
    description?: string | null
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
