export function GET() {
  return Response.json(
    { service: 'gamerhub-studio', status: 'ready' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
