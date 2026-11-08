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


class TabSessionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_token: str | None = None


class TabSessionView(BaseModel):
    status: Literal["ready"] = "ready"
    session_token: str


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


class LeaveRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID


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


class LeaveView(View):
    room_id: UUID
    room_version: int
    status: Literal["left", "closed"]


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


class VisibleOptionView(View):
    option_id: str
    label: str
    kind: Literal["prepared", "custom"] = "prepared"
    member_id: UUID | None = None


class CurrentNodeView(View):
    node_id: str
    title: str
    situation: str
    study_questions: list[str]
    options: list[VisibleOptionView]


FactValue = str | int | bool | None


class DecisionView(View):
    decision_id: UUID
    round_id: UUID
    round_number: int
    node_id: str
    question: str
    selected_option_id: str | None
    selected_option_label: str | None
    resolution_kind: Literal["prepared", "no_decision", "custom"]
    outcome_id: str
    text: str
    facts_before: dict[str, FactValue] = Field(validation_alias="facts_before_view")
    facts_after: dict[str, FactValue] = Field(validation_alias="facts_after_view")
    contribution_ids: list[UUID]
    resolved_at: datetime
    vote_counts: dict[str, int] = Field(validation_alias="vote_counts_view")
    selection_method: str
    ai_job_id: UUID | None = None
    ai_attempt: int | None = None
    proposer_id: UUID | None = None


class ProposalView(View):
    option_id: str
    member_id: UUID
    text: str
    contribution_id: UUID


class ResolutionView(View):
    job_id: UUID
    attempt: int
    option_id: str
    member_id: UUID
    text: str
    text_sha256: str
    selection_method: str
    status: str
    error: str | None
    processed_fragments: int
    total_fragments: int


class TurnView(View):
    member_id: UUID
    round_id: UUID
    phase_id: UUID
    reason: str
    started_at: datetime
    ended_at: datetime
    actor_id: UUID | None


class CeoChangeView(View):
    round_id: UUID
    previous_member_id: UUID
    member_id: UUID
    actor_id: UUID
    at: datetime


class NarrationCaptionView(View):
    narration_id: UUID
    phase_id: UUID
    text: str


class GameView(View):
    phase_id: UUID
    round_id: UUID
    round_number: int = Field(ge=1)
    started_at: datetime
    scenario: ScenarioRef
    timing_profile: str
    briefing_seconds: int
    result_seconds: int
    initial_node_id: str
    facts: dict[str, FactValue]
    public_documents: list[PublicDocumentView]
    eligible_member_ids: list[UUID]
    current_node: CurrentNodeView | None
    history: list[DecisionView]
    last_result: DecisionView | None
    ending_label: str | None
    narration: NarrationCaptionView | None
    server_time: datetime
    phase_deadline: datetime | None
    session_deadline: datetime | None
    active_speaker_id: UUID | None
    speaker_order: list[UUID]
    self_vote: str | None
    vote_counts: dict[str, int] | None
    tied_option_ids: list[str]
    allowed_actions: list[str]
    turns: list[TurnView]
    ceo_changes: list[CeoChangeView]
    ended_at: datetime | None
    feedback: dict[str, Any] | None = None
    proposals: list[ProposalView] = Field(default_factory=list)
    resolution: ResolutionView | None = None


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
    phase: Literal["briefing", "reading", "speaking", "discussion", "voting", "tie_break", "resolving", "resolution_failed", "decision", "result", "ended"]
    game: GameView


RoomView = Annotated[LobbyRoomView | StartedRoomView, Field(discriminator="phase")]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail


class ValidationErrorResponse(BaseModel):
    detail: list[dict[str, Any]]


class ContributionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    phase_id: UUID | None = None
    kind: Literal["answer", "chat"]
    source: Literal["typed", "speech"]
    text: str = Field(min_length=1, max_length=4000)

    @field_validator("text")
    @classmethod
    def require_text(cls, value):
        if not value.strip():
            raise ValueError("Submit final nonempty text")
        return value


class ContributionView(View):
    contribution_id: UUID
    sequence: int
    member_id: UUID
    role_id: str | None
    phase_id: UUID | None
    phase: str
    round_id: UUID | None
    round_number: int | None
    node_id: str | None
    kind: Literal["answer", "chat"]
    source: Literal["typed", "speech"]
    text: str
    at: datetime


class EvidenceMemberView(View):
    member_id: UUID
    display_name: str
    role_id: str
    eligible_from_round: int
    joined_at: datetime


class RecordingView(View):
    recording_id: UUID
    member_id: UUID
    round_id: UUID
    round_number: int
    phase_id: UUID
    status: str
    transcript: str
    reviewed_text: str | None
    error: str | None
    mime_type: str | None
    audio_available: bool
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: float | None


class EvaluationEvidenceView(View):
    room_id: UUID
    scenario: ScenarioRef
    started_at: datetime
    ended_at: datetime
    ending_label: str
    members: list[EvidenceMemberView]
    public_documents: list[PublicDocumentView]
    decisions: list[DecisionView]
    contributions: list[ContributionView]
    turns: list[TurnView]
    ceo_changes: list[CeoChangeView]
    recordings: list[RecordingView] = Field(default_factory=list)
    unresolved_action: ResolutionView | None = None


class PhaseCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    phase_id: UUID


class VoteCommand(PhaseCommand):
    option_id: str = Field(min_length=1, max_length=128)


class SkipCommand(PhaseCommand):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value):
        if not value.strip():
            raise ValueError("Provide a reason")
        return value


class CeoCommand(PhaseCommand):
    member_id: UUID


class ProposalCommand(PhaseCommand):
    text: str


class BeginRecording(PhaseCommand):
    round_id: UUID


class AudioBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_base64: str = Field(min_length=1, max_length=13_333_336)
    mime_type: str = Field(min_length=1, max_length=80)


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=12000)


class MediaView(View):
    status: Literal["disabled", "pending", "ready", "failed"]
    text: str
    error: str | None = None
    audio_url: str | None = None


class DeliveryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event: Literal["started", "completed", "failed"]
