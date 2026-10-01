# Model Provider Contract

## Purpose

使 planner、coder、vision、evaluator 的模型选择独立于 Agent Harness，并统一 streaming、tool calling、usage、capabilities、retry 与 cancellation。

## Interface

```ts
interface ModelProvider {
  readonly providerId: string;
  listModels(): Promise<ModelDescriptor[]>;
  generate(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
  countTokens(request: TokenCountRequest): Promise<TokenCount>;
  health(): Promise<ProviderHealth>;
}

type ModelDescriptor = {
  modelId: string;
  contextWindow: number;
  capabilities: Array<"text" | "vision" | "tool_calling" | "structured_output" | "reasoning">;
  maxOutputTokens: number;
};
```

## Request Rules

- Request includes `run_id`, `role`, normalized messages, optional images, normalized tool definitions, output schema, token budget, timeout and `AbortSignal`.
- Provider credentials are resolved by secret reference in the control plane; credentials never enter Run events, sandbox or Project state.
- A model route is snapshotted at Run start. Mid-Run fallback must emit `model.route_changed` and preserve tool/result compatibility.
- The adapter validates structured output and tool arguments after provider response even when provider claims strict schema support.
- Retry is limited to transport/rate-limit/provider-unavailable errors; invalid business output returns to the caller for repair and consumes the appropriate attempt budget.
- Usage is reported in normalized prompt/completion/cached token fields; unknown values are explicit `null`, never guessed.

## Role Routing Defaults

| Role | Required Capabilities | MVP Policy |
|---|---|---|
| `planner` | text, structured output | Fixed strong model |
| `coder` | text, tool calling, structured output | Fixed strong model |
| `vision` | text, vision | May equal coder if supported |
| `evaluator` | text, structured output; vision optional | Must not receive write tools |

## Stream Events

`message_start`, `text_delta`, `reasoning_delta` (developer-only), `tool_call_delta`, `tool_call_complete`, `usage`, `message_complete`, `provider_error`.

## Error Codes

`MODEL_UNAVAILABLE`, `MODEL_RATE_LIMITED`, `MODEL_TIMEOUT`, `MODEL_CONTEXT_EXCEEDED`, `MODEL_CAPABILITY_MISSING`, `MODEL_OUTPUT_INVALID`, `MODEL_AUTH_FAILED`, `MODEL_CANCELLED`.

## Contract Tests

- Cancellation interrupts an active stream.
- Partial tool-call deltas assemble by provider index/ID correctly.
- Empty/heartbeat chunks are tolerated.
- Tool arguments and structured output reject schema violations.
- Secret headers and raw provider errors are redacted.
- Fallback only selects a model satisfying the role capability set.
