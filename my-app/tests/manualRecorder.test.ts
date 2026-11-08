import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ManualTurnRecorder } from '../src/features/game/manualRecorder.ts'

const turn = (phaseId = 'one') => ({ phaseId, roundId: 'round', observedAt: 0, remainingMs: 30000 })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const flush = async () => { await new Promise((resolve) => setImmediate(resolve)) }
function fixture() {
    let stops = 0
    let starts = 0
    let recorderStops = 0
    let grants = 0
    let uploads = 0
    let fail = false
    const bodies: { id: string; body: { audio_base64: string; mime_type: string } }[] = []
    const stream = { getTracks: () => [{ stop: () => { stops++ } }] } as unknown as MediaStream
    const recorder = {
        state: 'inactive', mimeType: 'audio/webm;codecs=opus',
        ondataavailable: null as ((event: { data: Blob }) => void) | null,
        onstop: null as (() => void) | null,
        start() { starts++; this.state = 'recording' },
        stop() {
            recorderStops++; this.state = 'inactive'
            queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['final chunk']) }); this.onstop?.(); this.onstop?.() })
        },
    }
    const deps = {
        microphone: async () => stream,
        recorder: () => recorder as unknown as MediaRecorder,
        authorize: async () => true,
        grant: async () => { grants++; return { recording_id: 'original', audio_available: false } },
        upload: async (id: string, body: { audio_base64: string; mime_type: string }) => { uploads++; bodies.push({ id, body }); if (fail) throw new Error('offline') },
        encode: async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('base64'),
        now: () => 0,
    }
    const controller = new ManualTurnRecorder(deps)
    controller.setTurn(turn())
    return { controller, deps, stream, recorder, bodies, setFail: (value: boolean) => { fail = value }, counts: () => ({ stops, starts, recorderStops, grants, uploads }) }
}

test('manual stop releases tracks immediately, flushes final chunk and saves only once', async () => {
    const f = fixture()
    await f.controller.start()
    assert.equal(f.controller.getSnapshot().status, 'recording')
    f.controller.stop(); f.controller.stop()
    assert.equal(f.counts().stops, 1)
    assert.equal(f.counts().recorderStops, 1)
    assert.equal(f.counts().uploads, 0)
    await flush()
    assert.equal(f.counts().uploads, 1)
    assert.equal(Buffer.from(f.bodies[0].body.audio_base64, 'base64').toString(), 'final chunk')
    assert.equal(f.controller.getSnapshot().status, 'saved')
    f.controller.dispose()
})

test('permission arriving after cancellation is released and never creates a grant', async () => {
    const f = fixture(); const permission = deferred<MediaStream>()
    f.deps.microphone = () => permission.promise
    const started = f.controller.start()
    f.controller.stop()
    permission.resolve(f.stream)
    await started
    assert.equal(f.counts().starts, 0)
    assert.equal(f.counts().grants, 0)
    assert.ok(f.counts().stops >= 1)
    assert.equal(f.controller.getSnapshot().status, 'idle')
    f.controller.dispose()
})

test('phase change during grant or permission cannot start a stale recorder', async () => {
    for (const pendingAt of ['permission', 'grant']) {
        const f = fixture()
        const permission = deferred<MediaStream>()
        const grant = deferred<{ recording_id: string; audio_available: boolean }>()
        if (pendingAt === 'permission') f.deps.microphone = () => permission.promise
        else f.deps.grant = () => grant.promise
        const started = f.controller.start()
        await flush()
        f.controller.setTurn(turn('two'))
        permission.resolve(f.stream); grant.resolve({ recording_id: 'late', audio_available: false })
        await started
        assert.equal(f.counts().starts, 0)
        assert.ok(f.counts().stops >= 1)
        f.controller.dispose()
    }
})

test('saved original stays immutable and later turns require another deliberate start', async () => {
    const f = fixture()
    await f.controller.start(); f.controller.stop(); await flush()
    await f.controller.start()
    assert.equal(f.counts().starts, 1)
    f.controller.setTurn(turn('two')); await flush()
    assert.equal(f.controller.getSnapshot().status, 'idle')
    assert.equal(f.counts().starts, 1)
    await f.controller.start()
    assert.equal(f.counts().starts, 2)
    f.controller.stop(); await flush(); f.controller.dispose()
})

test('failed upload retains original ID, MIME and identical body across phase changes and blocks recapture', async () => {
    const f = fixture(); f.setFail(true)
    await f.controller.start(); f.controller.stop(); await flush()
    assert.equal(f.controller.getSnapshot().retryUpload, true)
    f.controller.setTurn(turn('two'))
    await f.controller.start()
    assert.equal(f.counts().starts, 1)
    f.setFail(false)
    await f.controller.retryUpload()
    assert.equal(f.bodies[0].id, 'original')
    assert.equal(f.bodies[0].body, f.bodies[1].body)
    assert.equal(f.bodies[1].body.mime_type, 'audio/webm;codecs=opus')
    f.controller.dispose()
})

test('server saved grant never opens a recorder even if transcript validation failed', async () => {
    const f = fixture()
    f.deps.grant = async () => ({ recording_id: 'saved', audio_available: true })
    await f.controller.start()
    assert.equal(f.controller.getSnapshot().status, 'saved')
    assert.equal(f.counts().starts, 0)
    await f.controller.start()
    assert.equal(f.counts().starts, 0)
    f.controller.dispose()
})

test('authority loss during capture stops and preserves the final original', async () => {
    const f = fixture()
    await f.controller.start()
    f.controller.setTurn(null)
    await flush()
    assert.equal(f.counts().recorderStops, 1)
    assert.equal(f.counts().uploads, 1)
    f.controller.dispose()
})

test('failed recorder start releases microphone tracks and preserves the visible error across room polls', async () => {
    const f = fixture()
    f.recorder.start = () => { throw new Error('Encoder unavailable') }
    await f.controller.start()
    assert.ok(f.counts().stops >= 1)
    assert.equal(f.controller.getSnapshot().status, 'error')
    f.controller.setTurn(turn())
    assert.equal(f.controller.getSnapshot().message, 'Encoder unavailable')
    f.controller.dispose()
})

test('double Start while permission is pending creates only one request and cancelled grant cannot record', async () => {
    const f = fixture()
    const grant = deferred<{ recording_id: string; audio_available: boolean }>()
    let grantCalls = 0
    f.deps.grant = () => { grantCalls++; return grant.promise }
    const first = f.controller.start(); await f.controller.start(); await flush()
    assert.equal(grantCalls, 1)
    f.controller.stop(); grant.resolve({ recording_id: 'late', audio_available: false }); await first
    assert.equal(f.counts().starts, 0)
    assert.ok(f.counts().stops >= 1)
    f.controller.dispose()
})

test('expired own turn cannot start after permission resolves', async () => {
    const f = fixture(); let now = 0
    const permission = deferred<MediaStream>()
    f.deps.now = () => now
    f.deps.microphone = () => permission.promise
    const first = f.controller.start(); now = 30001; permission.resolve(f.stream); await first
    assert.equal(f.counts().starts, 0)
    assert.equal(f.counts().grants, 0)
    assert.ok(f.counts().stops >= 1)
    assert.equal(f.controller.getSnapshot().status, 'idle')
    f.controller.dispose()
})


test('same phase expiration during authorization retires pending request without requiring Cancel', async () => {
    const f = fixture(); let now = 0
    const authority = deferred<boolean>()
    f.deps.now = () => now
    f.deps.authorize = () => authority.promise
    const first = f.controller.start(); await flush()
    now = 30001; authority.resolve(true); await first
    assert.equal(f.controller.getSnapshot().status, 'idle')
    assert.equal(f.counts().grants, 0)
    assert.ok(f.counts().stops >= 1)
    f.controller.dispose()
})

test('deadline timer stops capture, releases tracks and saves its final chunk', async () => {
    const f = fixture()
    f.controller.setTurn({ ...turn(), remainingMs: 20 })
    await f.controller.start()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(f.counts().recorderStops, 1)
    assert.ok(f.counts().stops >= 1)
    assert.equal(f.counts().uploads, 1)
    assert.equal(f.controller.getSnapshot().status, 'saved')
    f.controller.dispose()
})

test('unmount while permission is pending releases the late stream without granting or recording', async () => {
    const f = fixture(); const permission = deferred<MediaStream>()
    f.deps.microphone = () => permission.promise
    const started = f.controller.start()
    f.controller.dispose(); permission.resolve(f.stream); await started
    assert.equal(f.counts().grants, 0)
    assert.equal(f.counts().starts, 0)
    assert.ok(f.counts().stops >= 1)
})

test('authority guard denial stops capture and uploads the original once', async () => {
    const f = fixture()
    await f.controller.start()
    f.deps.authorize = async () => false
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(f.counts().recorderStops, 1)
    assert.equal(f.counts().uploads, 1)
    assert.ok(f.counts().stops >= 1)
    f.controller.dispose()
})
