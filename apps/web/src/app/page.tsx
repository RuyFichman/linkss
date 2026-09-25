import { PRODUCT } from "@/lib/product";

const foundations = [
  "Next.js + TypeScript",
  "Supabase Postgres, Auth e RLS",
  "Renderer público cacheável",
  "Analytics com retenção controlada",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-20">
      <section className="w-full rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm sm:p-12">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          Sprint 0
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          {PRODUCT.codename}: a fundação está pronta.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
          Base técnica para criar, publicar, medir e gerenciar bio pages. O nome é um codinome interno até a pesquisa de marca.
        </p>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2">
          {foundations.map((item) => (
            <li key={item} className="rounded-2xl border border-[var(--border)] px-5 py-4">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
