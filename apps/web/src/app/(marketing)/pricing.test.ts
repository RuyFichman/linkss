import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: "a" }));

const { PlanComparison, Pricing } = await import("./pricing");

const pricing = (customDomains = true) => renderToStaticMarkup(createElement(Pricing, { customDomains }));
const comparison = (customDomains = true) => renderToStaticMarkup(createElement(PlanComparison, { customDomains }));
const count = (html: string, text: string) => html.split(text).length - 1;
// What a screen reader gets: hidden elements dropped, then the tags.
const text = (html: string) => html.replace(/<(span|svg)[^>]*aria-hidden="true"[^>]*>.*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("home plans", () => {
  const html = pricing();

  it("links to the comparison table", () => {
    expect(html).toContain('href="#comparar"');
  });

  it("marks the free plan as the place to start, every plan with a way to sign up", () => {
    expect(html).toContain("Comece por aqui");
    expect(text(html)).toContain("R$ 0 por mês");
    expect(count(html, 'href="/cadastro"')).toBe(3);
    expect(count(html, "Criar minha página")).toBe(1);
  });

  it("offers a monthly/yearly choice, monthly first, with the months the yearly price leaves out", () => {
    expect(count(html, 'type="radio"')).toBe(2);
    expect(html).toMatch(/checked="" value="month"|value="month" checked=""/);
    expect(text(html)).toContain("Anual 2 meses grátis");
    expect(html).toContain("<legend");
  });

  it("shows both amounts of each paid plan, tagged by interval, and what yearly saves", () => {
    for (const amount of ["R$\u00a014,90", "R$\u00a0149,00", "R$\u00a057,90", "R$\u00a0579,00"]) expect(html).toContain(amount);
    expect(html).toMatch(/data-interval="year"><b[^>]*>R\$\u00a0149,00/);
    expect(text(html)).toContain("R$ 14,90 por mês");
    expect(text(html)).toContain("Economize R$ 29,80 por ano no plano anual");
    expect(text(html)).toContain("Economize R$ 115,80 por ano no plano anual");
    expect(count(html, "Criar conta e assinar")).toBe(2);
    expect(html).not.toContain("Em breve");
  });

  it("builds each next plan on the previous one", () => {
    expect(text(html)).toContain("Tudo do Gratuito");
    expect(text(html)).toContain("Tudo do Pro");
    expect(text(html)).toContain("Sem o selo do Linkfav");
  });

  it("names custom domains only when they are configured", () => {
    expect(html).toContain("Domínio próprio");
    expect(pricing(false)).not.toContain("Domínio próprio");
  });
});

describe("home comparison table", () => {
  const html = comparison();

  it("is a table with one column per plan, a header per group and a header per row", () => {
    expect(html).toContain('<table aria-labelledby="comparar-titulo"');
    expect(html).toMatch(/<th scope="col">Recurso<\/th><th scope="col">Gratuito<\/th><th scope="col">Pro<\/th><th scope="col">Agência<\/th>/);
    expect(count(html, 'scope="rowgroup"')).toBe(4);
    expect(count(html, 'scope="row"')).toBe(26);
  });

  it("says yes and no in words next to the icons, and limits as amounts", () => {
    expect(count(html, ">Sim<")).toBeGreaterThan(0);
    expect(count(html, ">Não<")).toBe(7);
    expect(html).toContain(">500 MB<");
    expect(html).toContain(">7 dias<");
    expect(html).toMatch(/Duplicar uma página<\/th><td>.*?Não.*?<\/td><td>.*?Não.*?<\/td><td>.*?Sim.*?<\/td>/);
  });

  it("drops the custom-domain row without the configuration", () => {
    expect(html).toContain("Domínio próprio");
    expect(comparison(false)).not.toContain("Domínio próprio");
    expect(count(comparison(false), 'scope="row"')).toBe(25);
  });
});
