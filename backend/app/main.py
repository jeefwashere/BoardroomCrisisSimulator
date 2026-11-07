"""Run from the repository root: python -m uvicorn backend.app.main:app."""

import os
import time
from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Request, Response, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyCookie

from .models import (ContributionBody, ContributionView, CreateRoom, DeliveryBody, ErrorResponse,
                     EvaluationEvidenceView, JoinRoom, MediaView, RoomView, ScenarioView, StartRoom,
                     ValidationErrorResponse)
from .narration import NarrationService
from .rooms import RoomError, Rooms, StartSpec
from .scenarios import ScenarioCatalog

COOKIE_NAME = "boardroom_session"


def create_app(*, secure_cookie: bool | None = None, allowed_origins: list[str] | None = None,
               clock: Callable[[], float] | None = None, rooms: Rooms | None = None,
               narration_service: NarrationService | None = None) -> FastAPI:
    if rooms is None:
        rooms = Rooms(ScenarioCatalog(), clock if clock is not None else time.monotonic)
    catalog = rooms.catalog
    speech = narration_service if narration_service is not None else NarrationService.from_env()
    secure = secure_cookie if secure_cookie is not None else os.getenv("BOARDROOM_SECURE_COOKIE", "false").lower() == "true"
    origins = allowed_origins if allowed_origins is not None else [
        origin.strip() for origin in os.getenv(
            "BOARDROOM_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if origin.strip()
    ]
    if "*" in origins:
        raise ValueError("Cookie authentication requires explicit allowed origins")
    app = FastAPI(title="Boardroom narrative and evidence API", version="0.3.0")
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=True,
        allow_methods=["GET", "POST"], allow_headers=["Content-Type"],
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

    cookie = APIKeyCookie(name=COOKIE_NAME, auto_error=False)

    async def session(value: Annotated[str | None, Security(cookie)]) -> str:
        return rooms.authenticate(value)

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

    @app.post("/api/rooms/{room_id}/contributions", response_model=ContributionView, status_code=201, responses=errors)
    async def contribute(room_id: UUID, body: ContributionBody, member_session: authenticated):
        return await rooms.contribute(member_session, room_id, body.command_id, body.phase_id,
                                      body.kind, body.source, body.text)

    @app.get("/api/rooms/{room_id}/contributions", response_model=list[ContributionView], responses=errors)
    async def contributions(room_id: UUID, member_session: authenticated):
        return await rooms.contributions(member_session, room_id)

    @app.get("/api/rooms/{room_id}/evaluation-evidence", response_model=EvaluationEvidenceView, responses=errors)
    async def evaluation_evidence(room_id: UUID, member_session: authenticated):
        return await rooms.evaluation_evidence(member_session, room_id)

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
