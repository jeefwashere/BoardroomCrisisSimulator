import { useEffect, useId, useRef, useState } from 'react'
import { describeDocumentsContext, DOCUMENT_ACCEPT, MAX_DOCUMENT_FILES, validateLobbyDocuments } from './documentContract'
import { uploadLobbyDocuments } from '../../services/documents'
import LobbyIcon from './LobbyIcon'

type DocumentUploadProps = {
    roomCode: string
    onContextChange: (context: string) => void
    onUploadingChange?: (uploading: boolean) => void
}

function DocumentUpload({ roomCode, onContextChange, onUploadingChange }: DocumentUploadProps) {
    const [status, setStatus] = useState<'idle' | 'uploading' | 'received' | 'error'>('idle')
    const [uploadError, setUploadError] = useState('')
    const errorId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const requestRef = useRef<AbortController | null>(null)
    const isUploading = status === 'uploading'

    useEffect(() => () => requestRef.current?.abort(), [])

    async function upload(files: File[]) {
        setUploadError('')
        const validationError = validateLobbyDocuments(files)
        if (validationError) {
            setStatus('error')
            setUploadError(validationError)
            return
        }

        requestRef.current?.abort()
        const controller = new AbortController()
        requestRef.current = controller
        setStatus('uploading')
        onUploadingChange?.(true)

        try {
            const receipts = await uploadLobbyDocuments(files, roomCode, controller.signal)
            if (!controller.signal.aborted) {
                setStatus('received')
                onContextChange(describeDocumentsContext(receipts))
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                setStatus('error')
                setUploadError(error instanceof Error ? error.message : 'Upload failed. Please try again.')
            }
        } finally {
            if (!controller.signal.aborted) onUploadingChange?.(false)
        }
    }

    return (
        <div className="lobby-document-upload">
            <input
                ref={inputRef}
                className="lobby-file-input"
                type="file"
                multiple
                disabled={isUploading}
                accept={DOCUMENT_ACCEPT}
                aria-label={`Choose up to ${MAX_DOCUMENT_FILES} DOC, DOCX, or PDF documents`}
                tabIndex={-1}
                onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? [])
                    event.currentTarget.value = ''
                    if (files.length) void upload(files)
                }}
            />
            {uploadError && <span id={errorId} className="lobby-upload-error" role="alert">{uploadError}</span>}
            <button
                className="lobby-upload-button"
                type="button"
                disabled={isUploading}
                aria-busy={isUploading}
                aria-describedby={uploadError ? errorId : 'room-context'}
                title={`Upload up to ${MAX_DOCUMENT_FILES} DOC, DOCX, or PDF documents, up to 20 MB each`}
                onClick={() => inputRef.current?.click()}
            >
                {isUploading ? <span className="lobby-spinner" /> : <LobbyIcon name={status === 'received' ? 'check' : 'upload'} />}
                <span>{isUploading ? 'Uploading…' : <>Upload<span className="lobby-upload-label-detail"> documents</span></>}</span>
            </button>
        </div>
    )
}

export default DocumentUpload
