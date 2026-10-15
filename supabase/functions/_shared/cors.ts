const allowedOrigins = new Set([
  'https://iwanhospital1.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
export function corsHeadersFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://iwanhospital1.github.io',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
