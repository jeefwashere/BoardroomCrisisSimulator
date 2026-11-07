"""The implemented lobby wire contract."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOM_CAPACITY = 30


class CreateRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
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
    room_code: str = Field(pattern=r"^[A-HJ-NP-Z2-9]{6}$")

    @field_validator("room_code", mode="before")
    @classmethod
    def clean_code(cls, value):
        return value.strip().upper() if isinstance(value, str) else value


class MemberView(BaseModel):
    model_config = ConfigDict(frozen=True)

    member_id: UUID
    display_name: str
    is_host: bool


class RoomView(BaseModel):
    room_id: UUID
    room_code: str
    room_version: int
    phase: Literal["lobby"] = "lobby"
    capacity: Literal[30] = ROOM_CAPACITY
    host_member_id: UUID
    self_member_id: UUID
    members: list[MemberView]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail
