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

from .models import CreateRoom, ErrorResponse, JoinRoom, RoomView, ScenarioView, StartRoom, ValidationErrorResponse
from .rooms import RoomError, Rooms, StartSpec
from .scenarios import ScenarioCatalog

COOKIE_NAME = "boardroom_session"


def create_app(*, secure_cookie: bool | None = None, allowed_origins: list[str] | None = None,
               clock: Callable[[], float] | None = None) -> FastAPI:
    catalog = ScenarioCatalog()
    rooms = Rooms(catalog, clock if clock is not None else time.monotonic)
    secure = secure_cookie if secure_cookie is not None else os.getenv("BOARDROOM_SECURE_COOKIE", "false").lower() == "true"
    origins = allowed_origins if allowed_origins is not None else [
        origin.strip() for origin in os.getenv(
            "BOARDROOM_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if origin.strip()
    ]
    if "*" in origins:
        raise ValueError("Cookie authentication requires explicit allowed origins")
    app = FastAPI(title="Boardroom room and Start API", version="0.2.0")
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
    errors = {status: {"model": ErrorResponse} for status in (401, 403, 404, 409)}
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

    return app


app = create_app()
