// Must equal the rows inserted into public.reserved_slugs (drift test) and include every top-level
// route segment under src/app (route test). Add new entries through a new migration as well.
export const RESERVED_SLUGS = [
  // Sprint 1
  "admin", "api", "app", "login", "logout", "proto", "p", "r", "suporte", "privacidade", "agencias", "profissionais",
  // Sprint 2 routes
  "auth", "cadastro", "entrar", "sair", "confirmar-email", "recuperar-acesso", "redefinir-senha",
  // Likely platform pages
  "ajuda", "termos", "precos", "planos", "status", "seguranca", "contato", "conta", "contas", "configuracoes", "relatorio", "relatorios", "blog", "www",
] as const;
