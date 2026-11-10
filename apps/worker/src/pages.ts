const THANK_YOU_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Thank you</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; color: #111827; }
  main { max-width: 28rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #4b5563; line-height: 1.5; }
  small { display: block; margin-top: 2rem; color: #9ca3af; }
  @media (prefers-color-scheme: dark) { body { background: #111827; color: #f9fafb; } p { color: #9ca3af; } }
</style>
</head>
<body>
<main>
  <h1>Thank you!</h1>
  <p>Your message has been sent. You can safely close this tab or go back.</p>
  <small>Powered by Auklet Forms</small>
</main>
</body>
</html>
`;

/** Headers every non-problem response carries. */
export function baseHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
}

export function thankYouPage(): Response {
  return new Response(THANK_YOU_HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
