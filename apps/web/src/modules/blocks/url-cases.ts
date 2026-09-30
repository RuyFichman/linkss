/**
 * Malicious or disallowed link destinations (ADR 0008). Vitest runs them through the TypeScript
 * policy; supabase/tests/database/100-blocks.test.sql stores the same strings (hex-encoded, so
 * control characters survive) and expects the database to refuse them. A drift test keeps the two
 * lists equal. NUL is TypeScript-only: Postgres text cannot hold it.
 */
export const MALICIOUS_URL_CASES: readonly (readonly [label: string, value: string])[] = [
  ["javascript scheme", "javascript:alert(1)"],
  ["mixed-case javascript", "JaVaScRiPt:alert(1)"],
  ["leading space", " javascript:alert(1)"],
  ["leading newline", "\njavascript:alert(1)"],
  ["tab inside scheme", "java\tscript:alert(1)"],
  ["control character inside scheme", "java\u0001script:alert(1)"],
  ["percent-encoded scheme", "%6Aavascript:alert(1)"],
  ["decimal entity", "&#106;avascript:alert(1)"],
  ["hex entity", "&#x6A;avascript:alert(1)"],
  ["named entity colon", "javascript&colon;alert(1)"],
  ["data URL", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
  ["vbscript", "vbscript:msgbox(1)"],
  ["file", "file:///etc/passwd"],
  ["blob", "blob:https://exemplo.com.br/0f3c"],
  ["about", "about:blank"],
  ["android intent", "intent://scan/#Intent;scheme=zxing;end"],
  ["custom app scheme", "whatsapp://send?phone=5511912345678"],
  ["ftp", "ftp://exemplo.com.br/arquivo"],
  ["protocol-relative", "//evil.example/login"],
  ["relative path", "/app/w/123"],
  ["credentials", "https://user:pass@exemplo.com.br/"],
  ["username only", "https://user@exemplo.com.br/"],
  ["whitespace inside", "https://exemplo.com.br/a b"],
  ["bidi override", "https://exemplo.com.br/\u202Egpj.exe"],
  ["localhost", "http://localhost:3000/"],
  ["IPv4 host", "http://192.168.0.1/"],
  ["mailto without address", "mailto:"],
  ["tel without digits", "tel:"],
];
