const paths = {
    crown: 'm3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Zm4 14h10',
    copy: 'M9 8h11v13H9zM5 16H3V3h11v2',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
    document: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6',
    plus: 'M12 5v14M5 12h14',
    back: 'm10 5-7 7 7 7M3 12h18',
    check: 'm5 12 4 4L19 6',
    play: 'm8 4 12 8-12 8V4Z',
} as const

function LobbyIcon({ name, className }: { name: keyof typeof paths; className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d={paths[name]} />
        </svg>
    )
}

export default LobbyIcon
