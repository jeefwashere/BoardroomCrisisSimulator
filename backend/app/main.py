"""Run from the repository root: python -m uvicorn backend.app.main:app."""

import asyncio
from contextlib import asynccontextmanager, suppress
import os
import time
from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Request, Response, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyCookie, APIKeyHeader
from fastapi.exceptions import RequestValidationError

from .models import (LeaveRoom, LeaveView, ProposalCommand, RecordingView, AudioBody, BeginRecording, ReviewBody, CeoCommand, PhaseCommand, SkipCommand, VoteCommand,
                     ContributionBody, ContributionView, CreateRoom, DeliveryBody, ErrorResponse,
                     EvaluationEvidenceView, JoinRoom, MediaView, RoomView, ScenarioView, StartRoom,
                     TabSessionBody, TabSessionView, ValidationErrorResponse)
from .narration import NarrationService
from .rooms import RoomError, Rooms, StartSpec
from .scenarios import ScenarioCatalog
from .recordings import Recordings
from .feedback import Feedback
from .custom_resolution import CustomResolver

COOKIE_NAME = "boardroom_session"
SESSION_HEADER = "X-Boardroom-Session"


def create_app(*, secure_cookie: bool | None = None, allowed_origins: list[str] | None = None,
               clock: Callable[[], float] | None = None, rooms: Rooms | None = None,
               narration_service: NarrationService | None = None,
               recordings_service: Recordings | None = None,
               inference_provider=None) -> FastAPI:
    if rooms is None:
        rooms = Rooms(ScenarioCatalog(), clock if clock is not None else time.monotonic)
    catalog = rooms.catalog
    speech = narration_service if narration_service is not None else NarrationService.from_env()
    recordings = recordings_service if recordings_service is not None else Recordings.from_env(rooms)
    feedback = Feedback(rooms, recordings, inference_provider)
    resolver = CustomResolver(rooms, inference_provider)
    secure = secure_cookie if secure_cookie is not None else os.getenv("BOARDROOM_SECURE_COOKIE", "false").lower() == "true"
    origins = allowed_origins if allowed_origins is not None else [
        origin.strip() for origin in os.getenv(
            "BOARDROOM_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if origin.strip()
    ]
    if "*" in origins:
        raise ValueError("Cookie authentication requires explicit allowed origins")
    async def run_clock():
        while True:
            await rooms.tick()
            await resolver.tick()
            await feedback.tick()
            await asyncio.sleep(0.1)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(run_clock())
        app.state.clock_task = task
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            await resolver.close()
            await feedback.close()
            await recordings.close()

    app = FastAPI(title="Boardroom gameplay and evidence API", version="0.4.0", lifespan=lifespan)
    app.state.feedback = feedback
    app.state.resolver = resolver
    app.state.recordings = recordings
    app.state.speech = speech
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=True,
        allow_methods=["GET", "POST"], allow_headers=["Content-Type", SESSION_HEADER],
    )

    @app.middleware("http")
    async def protect_browser_requests(request: Request, call_next):
        origin = request.headers.get("origin")
        same_origin = str(request.base_url).rstrip("/")
        if request.method == "POST" and origin is not None and origin not in [same_origin, *origins]:
            return JSONResponse(status_code=403, content={"detail": {
                "code": "origin_not_allowed", "message": "Browser origin is not allowed",
            }})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RoomError)
    async def room_error(request: Request, error: RoomError):
        return JSONResponse(status_code=error.status, content={"detail": {
            "code": error.code, "message": error.message,
        }})

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Keep actionable locations, without echoing raw credentials, audio or malformed Unicode.
        def safe(value):
            return str(value).encode("utf-8", errors="replace").decode("utf-8")
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": [part if isinstance(part, int) else safe(part) for part in item.get("loc", ())],
             "msg": safe(item.get("msg", "Invalid input")), "type": safe(item.get("type", "validation_error"))}
            for item in error.errors()
        ]})

    cookie = APIKeyCookie(name=COOKIE_NAME, auto_error=False)
    tab_header = APIKeyHeader(name=SESSION_HEADER, auto_error=False)

    async def session(request: Request, value: Annotated[str | None, Security(cookie)],
                      tab_value: Annotated[str | None, Security(tab_header)]) -> str:
        return rooms.authenticate(tab_value if SESSION_HEADER in request.headers else value)

    authenticated = Annotated[str, Depends(session)]
    errors = {status: {"model": ErrorResponse} for status in (401, 403, 404, 409, 410)}
    errors[422] = {"model": ErrorResponse | ValidationErrorResponse}

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "storage": "memory"}

    @app.get("/api/session", summary="Initialize or retain this browser's private session")
    async def initialize_session(request: Request, response: Response) -> dict[str, str]:
        token = rooms.session(request.cookies.get(COOKIE_NAME))
        response.set_cookie(COOKIE_NAME, token, httponly=True, secure=secure, samesite="lax", path="/api")
        return {"status": "ready"}

    @app.post("/api/tab-sessions", response_model=TabSessionView,
              summary="Initialize or resume an independent tab's private guest session")
    async def initialize_tab_session(body: TabSessionBody):
        return {"status": "ready", "session_token": rooms.session(body.session_token)}

    @app.get("/api/scenarios", response_model=list[ScenarioView])
    async def scenarios():
        return catalog.all()

    @app.post("/api/rooms", response_model=RoomView, status_code=201, responses=errors)
    async def create_room(body: CreateRoom, member_session: authenticated):
        return await rooms.create(member_session, body.command_id, body.room_code, body.display_name)

    @app.post("/api/rooms/join", response_model=RoomView, responses=errors)
    async def join_room(body: JoinRoom, member_session: authenticated):
        return await rooms.join(member_session, body.command_id, body.room_code, body.display_name, body.role_id)

    @app.post("/api/rooms/{room_id}/start", response_model=RoomView, responses=errors)
    async def start_room(room_id: UUID, body: StartRoom, member_session: authenticated):
        spec = StartSpec(body.room_code, body.scenario_id, body.scenario_version, body.timing_profile,
                         tuple((player.member_id, player.role_id) for player in body.players))
        return await rooms.start(member_session, room_id, body.command_id, spec)

    @app.get("/api/rooms/{room_id}", response_model=RoomView, responses=errors)
    async def get_room(room_id: UUID, member_session: authenticated):
        return await rooms.snapshot(member_session, room_id)

    @app.post("/api/rooms/{room_id}/leave", response_model=LeaveView, responses=errors)
    async def leave_lobby(room_id: UUID, body: LeaveRoom, member_session: authenticated):
        return await rooms.leave(member_session, room_id, body.command_id)

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/speaker/finish", response_model=RoomView, responses=errors)
    async def finish_speaking(room_id: UUID, round_id: UUID, body: PhaseCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "finish")

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/speaker/skip", response_model=RoomView, responses=errors)
    async def skip_speaker(room_id: UUID, round_id: UUID, body: SkipCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "skip", body.reason)

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/vote", response_model=RoomView, responses=errors)
    async def vote(room_id: UUID, round_id: UUID, body: VoteCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "vote", body.option_id)

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/tie-decision", response_model=RoomView, responses=errors)
    async def tie_decision(room_id: UUID, round_id: UUID, body: VoteCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "tie_decision", body.option_id)

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/ceo-reassignment", response_model=RoomView, responses=errors)
    async def reassign_ceo(room_id: UUID, round_id: UUID, body: CeoCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "reassign_ceo", body.member_id)

    @app.post("/api/rooms/{room_id}/end", response_model=RoomView, responses=errors)
    async def end_room(room_id: UUID, body: PhaseCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, None, "end")

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/proposal", response_model=RoomView, responses=errors)
    async def proposal(room_id: UUID, round_id: UUID, body: ProposalCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "proposal", body.text)

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/resolution/retry", response_model=RoomView, responses=errors)
    async def retry_resolution(room_id: UUID, round_id: UUID, body: PhaseCommand, member_session: authenticated):
        return await rooms.play(member_session, room_id, body.command_id, body.phase_id, round_id, "retry_resolution")

    @app.post("/api/rooms/{room_id}/feedback", response_model=RoomView, responses=errors)
    async def final_feedback(room_id: UUID, body: PhaseCommand, member_session: authenticated):
        await feedback.start(member_session, room_id)
        return await get_room(room_id, member_session)

    @app.get("/api/rooms/{room_id}/extras", responses=errors)
    async def extras(room_id: UUID, member_session: authenticated):
        contributions = await rooms.contributions(member_session, room_id)
        if (await rooms.snapshot(member_session, room_id)).phase == "ended":
            await feedback.start(member_session, room_id)
        return {"recordings": recordings.listing(member_session, room_id), "contributions": contributions,
                "feedback": feedback.view(room_id)}

    @app.post("/api/rooms/{room_id}/recordings/begin", responses=errors)
    async def begin_recording(room_id: UUID, body: BeginRecording, member_session: authenticated):
        return await recordings.begin(member_session, room_id, body.command_id, body.phase_id, body.round_id)

    @app.post("/api/rooms/{room_id}/recordings/{recording_id}", responses=errors)
    async def upload_recording(room_id: UUID, recording_id: UUID, request: Request, member_session: authenticated):
        recordings.require(member_session, room_id, recording_id, own=True)
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 13_335_000:
                raise RoomError(413, "audio_too_large", "Recording exceeds 10 MB")
            chunks.append(chunk)
        try:
            body = AudioBody.model_validate_json(b"".join(chunks))
        except ValueError as error:
            raise RoomError(422, "invalid_audio", "Submit valid audio encoding and type") from error
        return await recordings.upload(member_session, room_id, recording_id, body.audio_base64, body.mime_type)

    @app.post("/api/rooms/{room_id}/recordings/{recording_id}/review", responses=errors)
    async def review_recording(room_id: UUID, recording_id: UUID, body: ReviewBody, member_session: authenticated):
        return await recordings.review(member_session, room_id, recording_id, body.text)

    @app.get("/api/rooms/{room_id}/recordings/{recording_id}/audio", responses=errors)
    async def recording_audio(room_id: UUID, recording_id: UUID, member_session: authenticated):
        raw, mime = recordings.audio(member_session, room_id, recording_id)
        return Response(content=raw, media_type=mime, headers={"Content-Disposition": "inline"})

    @app.post("/api/rooms/{room_id}/contributions", response_model=ContributionView, status_code=201, responses=errors)
    async def contribute(room_id: UUID, body: ContributionBody, member_session: authenticated):
        return await rooms.contribute(member_session, room_id, body.command_id, body.phase_id,
                                      body.kind, body.source, body.text)

    @app.get("/api/rooms/{room_id}/contributions", response_model=list[ContributionView], responses=errors)
    async def contributions(room_id: UUID, member_session: authenticated):
        return await rooms.contributions(member_session, room_id)

    @app.get("/api/rooms/{room_id}/evaluation-evidence", response_model=EvaluationEvidenceView, responses=errors)
    async def evaluation_evidence(room_id: UUID, member_session: authenticated):
        result = EvaluationEvidenceView.model_validate(await rooms.evaluation_evidence(member_session, room_id))
        result.recordings = [RecordingView.model_validate(item) for item in recordings.listing(member_session, room_id)]
        return result

    def media_view(result, room_id, narration_id):
        return {"status": result.status, "text": result.text, "error": result.error,
                "audio_url": f"/api/rooms/{room_id}/narration/{narration_id}/audio" if result.status == "ready" else None}

    @app.get("/api/rooms/{room_id}/narration/{narration_id}", response_model=MediaView, responses=errors)
    async def narration_status(room_id: UUID, narration_id: UUID, member_session: authenticated):
        caption = await rooms.narration(member_session, room_id, narration_id)
        return media_view(speech.status(room_id, narration_id, caption.text), room_id, narration_id)

    @app.post("/api/rooms/{room_id}/narration/{narration_id}/prepare", response_model=MediaView, responses=errors)
    async def prepare_narration(room_id: UUID, narration_id: UUID, member_session: authenticated):
        caption = await rooms.narration(member_session, room_id, narration_id)
        result = await speech.prepare(room_id, narration_id, caption.text)
        current = await rooms.narration(member_session, room_id, narration_id)
        if current.phase_id != caption.phase_id:
            raise RoomError(410, "narration_expired", "The narration phase has changed")
        return media_view(result, room_id, narration_id)

    @app.get("/api/rooms/{room_id}/narration/{narration_id}/audio", response_class=Response, responses=errors)
    async def narration_audio(room_id: UUID, narration_id: UUID, member_session: authenticated):
        await rooms.narration(member_session, room_id, narration_id)
        try:
            audio = speech.audio(room_id, narration_id)
        except KeyError as error:
            raise RoomError(404, "narration_not_ready", "Narration audio is not ready") from error
        return Response(content=audio, media_type="audio/mpeg")

    @app.post("/api/rooms/{room_id}/narration/{narration_id}/delivery", responses=errors)
    async def narration_delivery(room_id: UUID, narration_id: UUID, body: DeliveryBody, member_session: authenticated):
        grant = await rooms.narration(member_session, room_id, narration_id)
        try:
            speech.record_delivery(room_id, narration_id, grant.member_id, body.event)
        except (ValueError, KeyError) as error:
            raise RoomError(409, "invalid_delivery", "Playback is not ready or its event order is invalid") from error
        return {"status": "recorded"}

    return app


app = create_app()
