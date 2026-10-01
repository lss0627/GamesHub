"""Tool contracts enforced in Python even when a model host validates too."""
import asyncio
import hashlib
import json
from dataclasses import dataclass

from jsonschema import Draft202012Validator, ValidationError

from .client import PiError


class ToolError(PiError):
    def __init__(self, message):
        self.code = message.split('\n')[0]
        self.message = message
        # Retrying requires changed arguments/phase; unknown side effects are never auto-retried.
        self.retryable = self.code == 'TOOL_ARGUMENTS_INVALID'
        super().__init__(message)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict
    phases: frozenset
    safety_class: str
    timeout_seconds: float = 30
    max_output_bytes: int = 12000
    replay: str = 'never'
    version: str = '1.0'
    evidence_kind: str = 'structured_result'


def bound_result(result, maximum):
    raw = json.dumps(result, ensure_ascii=False).encode('utf8')
    if len(raw) <= maximum:
        return result
    # Preserve machine-readable failure receipts. Never reinterpret truncation as success.
    receipt = {k: result[k] for k in ('status', 'exitCode', 'timedOut', 'isError', 'code', 'hash', 'path', 'logId') if k in result}
    receipt.update(truncated=True, originalBytes=len(raw), contentHash=hashlib.sha256(raw).hexdigest())
    text = str(result.get('output', result.get('content', json.dumps(result, ensure_ascii=False))))
    room = max(0, maximum - len(json.dumps(receipt, ensure_ascii=False).encode('utf8')) - 100)
    receipt['output'] = text.encode('utf8')[-room:].decode('utf8', errors='ignore') if room else ''
    while len(json.dumps(receipt, ensure_ascii=False).encode('utf8')) > maximum and receipt['output']:
        receipt['output'] = receipt['output'][max(1, len(receipt['output']) // 8):]
    if len(json.dumps(receipt, ensure_ascii=False).encode('utf8')) > maximum:
        raise ToolError('TOOL_RECEIPT_TOO_LARGE')
    return receipt


class ToolRegistry:
    def __init__(self):
        self.entries = {}

    def register(self, spec, handler):
        if spec.name in self.entries or spec.max_output_bytes < 512 or spec.timeout_seconds <= 0:
            raise ValueError('Invalid tool registration')
        Draft202012Validator.check_schema(spec.parameters)
        # All schemas are program-defined; never resolve network references from tools.
        if '"$ref"' in json.dumps(spec.parameters):
            raise ValueError('Tool schemas must be self-contained')
        self.entries[spec.name] = (spec, handler, Draft202012Validator(spec.parameters))

    def definitions(self):
        return [{'name': s.name, 'description': s.description, 'parameters': s.parameters, 'replay': s.replay,
                 'executionMode': 'sequential'} for s, _, _ in self.entries.values()]

    def describe(self):
        return [{'name': s.name, 'description': s.description, 'phases': sorted(s.phases), 'safetyClass': s.safety_class,
                 'timeoutSeconds': s.timeout_seconds, 'maxOutputBytes': s.max_output_bytes, 'replay': s.replay,
                 'version': s.version, 'evidenceKind': s.evidence_kind}
                for s, _, _ in self.entries.values()]

    def validate(self, name, args, phase):
        if name not in self.entries:
            raise ToolError('TOOL_NOT_ALLOWED')
        spec, _, validator = self.entries[name]
        if phase not in spec.phases:
            raise ToolError('TOOL_PHASE_DENIED')
        try:
            validator.validate(args)
        except ValidationError as error:
            raise ToolError('TOOL_ARGUMENTS_INVALID') from error
        return spec

    async def invoke(self, name, args, *, phase):
        spec = self.validate(name, args, phase)
        try:
            async with asyncio.timeout(spec.timeout_seconds):
                result = await self.entries[name][1](args)
        except TimeoutError as error:
            raise ToolError('TOOL_TIMEOUT') from error
        return bound_result(result, spec.max_output_bytes)
