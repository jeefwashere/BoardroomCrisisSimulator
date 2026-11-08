type PreparedOption = { option_id: string; label: string }

export function voteCountSummary(counts: Record<string, number>, options: PreparedOption[] = []): string {
    const entries = Object.entries(counts)
    const labels = new Map(options.map((option) => [option.option_id, option.label]))
    if (entries.every(([id]) => labels.has(id))) {
        return `Final vote counts: ${entries.map(([id, count]) => `${labels.get(id)}: ${count}`).join(', ')}`
    }
    return `Recorded ballots: ${entries.reduce((total, [, count]) => total + count, 0)}.`
}
