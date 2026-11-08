export default function CallIcon({ name }: { name: 'incident' | 'text' | 'leave' | 'finish' | 'skip' | 'close' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {name === 'incident' && <path d="M14 3H6v18h12V7zM14 3v5h4M9 12h6M9 16h6" />}
        {name === 'text' && <path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5" />}
        {name === 'leave' && <path d="M4 16l-2-4c5-5 15-5 20 0l-2 4-5-2v-3H9v3z" />}
        {name === 'finish' && <path d="m5 12 4 4L19 6" />}
        {name === 'skip' && <><path d="m5 5 10 7-10 7zM19 5v14" /></>}
        {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
    </svg>
}
