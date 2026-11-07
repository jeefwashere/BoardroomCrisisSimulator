"""HTTP requests and public room projections."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, field_validator

from .rules import PRESENCE_WINDOW_SECONDS, ROOM_CAPACITY


def normalize_code(value):
    return value.strip().upper() if isinstance(value, str) else value


RoomCode = Annotated[str, BeforeValidator(normalize_code), StringConstraints(pattern=r"^[A-Z0-9]{6}$")]
RoleId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class CreateRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    room_code: RoomCode
    display_name: str = Field(min_length=1, max_length=40)

    @field_validator("display_name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if any(not char.isprintable() for char in value):
                raise ValueError("Display names must contain printable characters")
        return value


class JoinRoom(CreateRoom):
    role_id: RoleId | None = None


class PlayerRole(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_id: UUID
    role_id: RoleId


class StartRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    room_code: RoomCode
    scenario_id: str = Field(min_length=1, max_length=64)
    scenario_version: int = Field(gt=0, strict=True)
    timing_profile: str = Field(min_length=1, max_length=64)
    players: list[PlayerRole] = Field(min_length=1, max_length=ROOM_CAPACITY)


class View(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MemberView(View):
    member_id: UUID
    display_name: str
    is_host: bool
    connected: bool
    role_id: str | None
    eligible_from_round: int | None
    eligible_current_round: bool


class PublicDocumentView(View):
    id: str
    text: str


class RoleView(View):
    role_id: str
    name: str


class TimingView(View):
    profile_id: str
    briefing_seconds: int


class ScenarioRef(View):
    scenario_id: str
    version: int
    title: str
    content_sha256: str


class ScenarioView(ScenarioRef):
    roles: list[RoleView]
    timings: list[TimingView]


class BriefingView(View):
    phase_id: UUID
    round_number: Literal[1]
    started_at: datetime
    scenario: ScenarioRef
    timing_profile: str
    briefing_seconds: int
    initial_node_id: str
    initial_metrics: dict[str, int]
    public_documents: list[PublicDocumentView]
    eligible_member_ids: list[UUID]


class RoomFields(View):
    room_id: UUID
    room_code: str
    room_version: int
    capacity: Literal[30] = ROOM_CAPACITY
    presence_window_seconds: Literal[30] = PRESENCE_WINDOW_SECONDS
    host_member_id: UUID
    self_member_id: UUID
    members: list[MemberView]


class LobbyRoomView(RoomFields):
    phase: Literal["lobby"]
    game: None = None


class StartedRoomView(RoomFields):
    phase: Literal["briefing"]
    game: BriefingView


RoomView = Annotated[LobbyRoomView | StartedRoomView, Field(discriminator="phase")]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail


class ValidationErrorResponse(BaseModel):
    detail: list[dict[str, Any]]
