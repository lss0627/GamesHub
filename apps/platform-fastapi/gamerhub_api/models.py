from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ProjectInput(Input):
    name: str = Field(min_length=1, max_length=120)


class RevisionInput(Input):
    revision: int = Field(ge=0, strict=True)


class MessageInput(RevisionInput):
    message: str = Field(min_length=1, max_length=4000)
    creationMode: Literal['quick', 'discuss'] = 'discuss'


class RunInput(Input):
    request_type: Literal['create', 'modify', 'rollback']
    prompt: str = Field(min_length=1, max_length=100_000)


class ControlInput(Input):
    reason: str | None = Field(default=None, max_length=1000)


class UploadInput(Input):
    name: str = Field(min_length=1, max_length=255)
    mime_type: Literal['image/png', 'image/jpeg', 'image/webp', 'audio/wav']
    bytes_base64: str = Field(min_length=1, max_length=7 * 1024 * 1024)
    license_text: str = Field(min_length=1, max_length=10_000)
    created_by_run_id: UUID | None = None

    @field_validator('bytes_base64')
    @classmethod
    def valid_base64(cls, value):
        import base64
        try:
            content = base64.b64decode(value, validate=True)
        except ValueError as error:
            raise ValueError('ASSET_BASE64_INVALID') from error
        if not content or len(content) > 5 * 1024 * 1024:
            raise ValueError('SIZE_LIMIT')
        return value


class GenerateInput(RevisionInput):
    prompt: str = Field(min_length=1, max_length=1500)
    source: Literal['builtin', 'image-provider'] = 'builtin'


class SelectInput(RevisionInput):
    candidateId: str = Field(min_length=1, max_length=100)


class ImageInput(Input):
    bytes_base64: str = Field(min_length=1, max_length=8 * 1024 * 1024)
    mime_type: str | None = None


class CreativeInput(RevisionInput):
    document: dict


class CreativePromptInput(RevisionInput):
    prompt: str = Field(min_length=1, max_length=2000)
