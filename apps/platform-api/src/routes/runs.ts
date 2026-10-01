import type { PlatformApi, PlatformRequest, PlatformResponse } from '../app';

export function createRunRoutes(api: PlatformApi) {
  return {
    request: (request: PlatformRequest): Promise<PlatformResponse> =>
      api.request(request),
  };
}
