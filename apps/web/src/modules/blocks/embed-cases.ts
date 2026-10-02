/**
 * Inputs an embed must never accept (ADR 0010). Vitest feeds them to the address parser;
 * supabase/tests/database/110-new-blocks.test.sql stores the same strings (hex-encoded) as the
 * `ref` of every provider and expects the database to refuse them. A drift test keeps both equal.
 */
export const MALICIOUS_EMBED_CASES: readonly (readonly [label: string, value: string])[] = [
  ["pasted iframe", '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'],
  ["pasted script", '<script src="https://evil.example/x.js"></script>'],
  ["unknown host", "https://evil.example/watch?v=dQw4w9WgXcQ"],
  ["lookalike suffix", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
  ["lookalike prefix", "https://evilyoutube.com/watch?v=dQw4w9WgXcQ"],
  ["lookalike short host", "https://youtu.be.evil.example/dQw4w9WgXcQ"],
  ["provider as userinfo", "https://www.youtube.com@evil.example/watch?v=dQw4w9WgXcQ"],
  ["javascript scheme", "javascript:alert(1)"],
  ["data URL", "data:text/html,<script>alert(1)</script>"],
  ["protocol-relative", "//www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["markup in the id", 'https://www.youtube.com/watch?v="><script>alert(1)</script>'],
  ["path traversal in the id", "https://www.youtube.com/embed/../../redirect"],
  ["redirect endpoint", "https://www.youtube.com/redirect?q=https://evil.example"],
  ["attribution link", "https://www.youtube.com/attribution_link?u=/watch?v=dQw4w9WgXcQ"],
  ["id with extra parameters", "dQw4w9WgXcQ?autoplay=1"],
  ["id with a second path", "dQw4w9WgXcQ/../../x"],
  ["vimeo id with markup", 'https://vimeo.com/123456"onload="alert(1)'],
  ["vimeo non-numeric id", "https://vimeo.com/channels/staffpicks"],
  ["spotify user page", "https://open.spotify.com/user/evil"],
  ["spotify id with markup", "https://open.spotify.com/track/<img src=x onerror=alert(1)>"],
  ["spotify lookalike", "https://open.spotify.com.evil.example/track/4uLU6hMCjMI75M1A2tKUQC"],
];
