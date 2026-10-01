/** Generated from specs/001-ai-game-creation-platform/contracts/openapi.yaml. */
export interface ApiError {
  code: string;
  message?: string;
  request_id?: string;
}
export interface ProjectResponse {
  id: string;
  name: string;
  engine_type: 'unity';
  engine_version: '6000.0.80f1';
  status: string;
}
export interface RunResponse {
  id: string;
  project_id: string;
  trace_id: string;
  status: string;
  request_type: string;
}
export interface RunEventResponse {
  sequence: number;
  run_id: string;
  type: string;
  visibility: 'creator' | 'developer' | 'operator' | 'audit';
  occurred_at: string;
  trace_id?: string;
  span_id?: string;
  payload: Record<string, unknown>;
}
export type ApiMethod = 'GET' | 'POST';
