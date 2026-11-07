import { useEffect, useRef, useState } from 'react'
import { describeRoomContext, DOCUMENT_ACCEPT, validateLobbyDocument } from './documentContract'
import { uploadLobbyDocument } from '../../services/documents'
import LobbyIcon from './LobbyIcon'

type DocumentUploadProps = {
    roomCode: string
    onContextChange: (context: string) => void
    onUploadingChange?: (uploading: boolean) => void
}

function DocumentUpload({ roomCode, onContextChange, onUploadingChange }: DocumentUploadProps) {
    const [status, setStatus] = useState<'idle' | 'uploading' | 'received' | 'error'>('idle')
    const inputRef = useRef<HTMLInputElement>(null)
    const requestRef = useRef<AbortController | null>(null)
    const isUploading = status === 'uploading'

    useEffect(() => () => requestRef.current?.abort(), [])

    async function upload(file: File) {
        const validationError = validateLobbyDocument(file)
        if (validationError) {
            setStatus('error')
            onContextChange(validationError)
            return
        }

        requestRef.current?.abort()
        const controller = new AbortController()
        requestRef.current = controller
        setStatus('uploading')
        onUploadingChange?.(true)
        onContextChange(`Uploading ${file.name}…`)

        try {
            const receipt = await uploadLobbyDocument(file, roomCode, controller.signal)
            if (!controller.signal.aborted) {
                setStatus('received')
                onContextChange(describeRoomContext(receipt))
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                setStatus('error')
                onContextChange(error instanceof Error ? error.message : 'Upload failed. Please try again.')
            }
        } finally {
            if (!controller.signal.aborted) onUploadingChange?.(false)
        }
    }

    return (
        <>
            <input
                ref={inputRef}
                className="lobby-file-input"
                type="file"
                accept={DOCUMENT_ACCEPT}
                aria-label="Choose a DOC, DOCX, or PDF document"
                tabIndex={-1}
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) void upload(file)
                }}
            />
            <button
                className="lobby-upload-button"
                type="button"
                disabled={isUploading}
                aria-busy={isUploading}
                aria-describedby="room-context"
                title="Upload a DOC, DOCX, or PDF document, up to 20 MB"
                onClick={() => inputRef.current?.click()}
            >
                {isUploading ? <span className="lobby-spinner" /> : <LobbyIcon name={status === 'received' ? 'check' : 'upload'} />}
                <span>{isUploading ? 'Uploading…' : <>Upload<span className="lobby-upload-label-detail"> document</span></>}</span>
            </button>
        </>
    )
}

export default DocumentUpload
