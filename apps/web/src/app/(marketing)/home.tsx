import { formatMoney } from "@/modules/billing/catalog";
import { paidPlansAreOnSale } from "@/modules/billing/marketing";
import { resolveBillingMode } from "@/modules/billing/mode";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Schibsted_Grotesk } from "next/font/google";
import { HOME_COPY } from "@/content/pt-BR";
import { publicAddressLabel } from "@/lib/app-url";
import { PRODUCT } from "@/lib/product";
import "./home.css";

const displayFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-home-display", display: "swap" });

const SIGN_UP_PATH = "/cadastro";
const SIGN_IN_PATH = "/entrar";

type PhoneKey = keyof typeof HOME_COPY.phones;
type PhoneLook = { bg: string; text: string; muted: string; button: string; buttonText: string; radius: string; cover: string; outline?: boolean };

// Illustrative pages drawn in CSS: invented names, no customer content and no image requests.
const PHONE_LOOKS: Record<PhoneKey, PhoneLook> = {
  creator: { bg: "#f1f1f4", text: "#1d1d28", muted: "#5b6072", button: "#ffffff", buttonText: "#1d1d28", radius: "0.9rem", cover: "linear-gradient(160deg, #f6b26b, #d9534f 55%, #5b3a8c)" },
  local: { bg: "#f5efe5", text: "#231f1a", muted: "#5e574e", button: "#1f5b49", buttonText: "#ffffff", radius: "1rem", cover: "linear-gradient(150deg, #8fc79a, #1f5b49)" },
  shop: { bg: "#0f3f5c", text: "#ffffff", muted: "#cfe3ee", button: "#35c3d6", buttonText: "#06202c", radius: "0.5rem", cover: "linear-gradient(150deg, #35c3d6, #f29b4b)" },
  service: { bg: "#eef5f2", text: "#16352d", muted: "#49665e", button: "#225e50", buttonText: "#ffffff", radius: "0.6rem", cover: "linear-gradient(150deg, #b7dccf, #225e50)", outline: true },
  event: { bg: "#100f12", text: "#ffffff", muted: "#c9c5ce", button: "#c21870", buttonText: "#ffffff", radius: "0.25rem", cover: "linear-gradient(150deg, #c21870, #3b1d6e)" },
};

const TEMPLATE_RAIL: readonly { phone: PhoneKey; name: string }[] = [
  { phone: "local", name: "Negócio local" },
  { phone: "creator", name: "Criador e lançamento" },
  { phone: "service", name: "Profissional independente" },
  { phone: "shop", name: "Pequena loja" },
  { phone: "event", name: "Evento e artista" },
];

function initials(name: string): string {
  return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function PhoneMock({ phone }: { phone: PhoneKey }) {
  const look = PHONE_LOOKS[phone];
  const copy = HOME_COPY.phones[phone];
  const style = { "--phone-bg": look.bg, "--phone-text": look.text, "--phone-muted": look.muted, "--phone-button": look.button, "--phone-button-text": look.buttonText, "--phone-radius": look.radius, "--phone-cover": look.cover } as CSSProperties;
  return (
    <div className="home-phone" style={style} aria-hidden="true">
      <div className="home-phone-cover" />
      <div className="home-phone-avatar">{initials(copy.name)}</div>
      <div className="home-phone-body">
        <p className="home-phone-name">{copy.name}</p>
        <p className="home-phone-bio">{copy.bio}</p>
        <div className="home-phone-socials"><i /><i /><i /></div>
        <div className="home-phone-button">{copy.primary}</div>
        <div className="home-phone-button" data-outline={look.outline ? "" : undefined}>{copy.secondary}</div>
        <div className="home-phone-media" />
      </div>
    </div>
  );
}

/** The address a new page gets, next to the sign-up button. Text only: the address is chosen after sign-up. */
function ClaimBar() {
  const [host] = publicAddressLabel("").split("/");
  return (
    <div className="home-claim">
      <p className="home-claim-address m-0">{host}/<span>{HOME_COPY.hero.addressPlaceholder}</span></p>
      <Link className="home-cta" href={SIGN_UP_PATH}>{HOME_COPY.hero.cta}</Link>
    </div>
  );
}

function PlanCard({ name, description, items, price, priceNote, featured = false, available = featured, cta }: { name: string; description: string; items: readonly string[]; price?: string; priceNote?: string; featured?: boolean; available?: boolean; cta?: string }) {
  const copy = HOME_COPY.plans;
  return (
    <article className="home-plan" data-featured={featured ? "" : undefined}>
      <div className="home-plan-head">
        <h3 className="home-display">{name}</h3>
        <span className="home-plan-tag" data-kind={available ? "available" : "soon"}>{available ? copy.available : copy.soon}</span>
      </div>
      {price ? <p className="home-plan-price home-display">{price}</p> : null}
      {priceNote ? <p className="home-plan-description">{priceNote}</p> : null}
      <p className="home-plan-description">{description}</p>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
      {featured || cta ? <Link className="home-cta home-cta-block" href={SIGN_UP_PATH}>{cta ?? copy.free.cta}</Link> : null}
    </article>
  );
}

export function Home() {
  const copy = HOME_COPY;
  const { free, pro, agency } = PRODUCT.plans;
  const item = copy.plans.items;
  // Paid plans are offered here only when a visitor can actually buy them. Read at build time:
  // changing the billing mode needs a redeploy, like every other value this static page shows.
  const selling = paidPlansAreOnSale(resolveBillingMode().mode);
  const paid = (planId: "pro" | "agency") => (selling ? { available: true, price: copy.plans.perMonth(formatMoney(PRODUCT.plans[planId].monthlyPriceInCents)), priceNote: copy.plans.orPerYear(formatMoney(PRODUCT.plans[planId].yearlyPriceInCents)), cta: copy.plans.paidCta } : {});
  return (
    <div className={`home ${displayFont.variable}`}>
      <header className="home-shell home-header">
          <Link className="home-brand" href="/">{PRODUCT.name}</Link>
          <nav className="home-nav" aria-label={copy.nav.label}>
            <a href="#recursos">{copy.nav.features}</a>
            <a href="#modelos">{copy.nav.templates}</a>
            <a href="#planos">{copy.nav.plans}</a>
            <a href="#duvidas">{copy.nav.faq}</a>
          </nav>
          <div className="home-header-actions">
            <Link className="home-signin" href={SIGN_IN_PATH}>{copy.nav.signIn}</Link>
            <Link className="home-cta" href={SIGN_UP_PATH}>{copy.nav.signUp}</Link>
          </div>
      </header>

      <main id="conteudo">
        <div className="home-wash home-hero-wash">
          <section className="home-shell home-hero">
            <div>
              <p className="home-badge m-0"><span className="home-badge-dot" aria-hidden="true" />{copy.hero.badge}</p>
              <h1 className="home-display">{copy.hero.title}</h1>
              <p className="home-hero-lead">{copy.hero.lead}</p>
              <ClaimBar />
            </div>
            <div className="home-fan">
              <PhoneMock phone="local" />
              <PhoneMock phone="creator" />
              <PhoneMock phone="shop" />
            </div>
          </section>
        </div>

      <div className="home-marquee">
        <div className="home-marquee-track">
          <ul>{copy.marquee.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <ul aria-hidden="true">{copy.marquee.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </div>
      </div>

      <section className="home-section" id="modelos" aria-labelledby="modelos-titulo">
        <div className="home-shell home-heading">
          <h2 className="home-display" id="modelos-titulo">{copy.templates.title}</h2>
          <p>{copy.templates.lead}</p>
        </div>
        <ul className="home-rail">
          {TEMPLATE_RAIL.map(({ phone, name }) => (
            <li key={phone}><PhoneMock phone={phone} /><span className="home-rail-name">{name}</span></li>
          ))}
        </ul>
        <p className="home-center m-0"><Link className="home-cta" href={SIGN_UP_PATH}>{copy.templates.cta}</Link></p>
      </section>

      <section className="home-section home-shell" aria-labelledby="editor-titulo">
        <div className="home-heading">
          <h2 className="home-display" id="editor-titulo">{copy.editor.title}</h2>
          <p>{copy.editor.lead}</p>
        </div>
        <div className="home-editor" aria-hidden="true">
          <div className="home-editor-panel">
            <div className="home-editor-bar">
              <b className="home-display">{copy.editor.panelTitle}</b>
              <span className="home-editor-status">{copy.editor.saved}<span className="home-editor-publish">{copy.editor.publish}</span></span>
            </div>
            <ul className="home-editor-blocks">{copy.editor.blocks.map((block) => <li key={block}>{block}</li>)}</ul>
          </div>
          <div className="home-editor-preview">{copy.editor.previewLabel}<PhoneMock phone="service" /></div>
        </div>
      </section>

      <section className="home-section home-shell" id="recursos" aria-labelledby="recursos-titulo">
        <div className="home-heading">
          <h2 className="home-display" id="recursos-titulo">{copy.features.title}</h2>
          <p>{copy.features.lead}</p>
        </div>
        <div className="home-features">
          <div className="home-features-phone"><PhoneMock phone="creator" /></div>
          <ul className="home-features-list">
            {copy.features.items.map((feature) => (
              <li key={feature.title}><h3 className="home-display">{feature.title}</h3><p>{feature.body}</p></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-section home-shell" id="planos" aria-labelledby="planos-titulo">
        <div className="home-heading">
          <h2 className="home-display" id="planos-titulo">{copy.plans.title}</h2>
          <p>{selling ? copy.plans.leadSelling : copy.plans.lead}</p>
        </div>
        <div className="home-plans">
          <PlanCard featured name={copy.plans.free.name} price={copy.plans.free.price} description={copy.plans.free.description} items={[item.profiles(free.includedProfiles), item.allBlocks, item.leads, item.analyticsDays(free.analyticsDays), item.storage(free.storageMb)]} />
          <PlanCard {...paid("pro")} name={copy.plans.pro.name} description={copy.plans.pro.description} items={[item.profiles(pro.includedProfiles), item.analyticsDays(pro.analyticsDays), item.storage(pro.storageMb)]} />
          <PlanCard {...paid("agency")} name={copy.plans.agency.name} description={copy.plans.agency.description} items={[item.profiles(agency.includedProfiles), item.teamMembers(agency.teamMembers), item.consolidated, item.reports, item.analyticsDays(agency.analyticsDays), item.storage(agency.storageMb)]} />
        </div>
      </section>

      <section className="home-section home-shell" id="duvidas" aria-labelledby="duvidas-titulo">
        <div className="home-heading">
          <h2 className="home-display" id="duvidas-titulo">{copy.faq.title}</h2>
          <p>{copy.faq.lead}</p>
        </div>
        <div className="home-faq">
          {copy.faq.items.map((entry) => (
            <details key={entry.question}><summary>{entry.question}</summary><p>{selling && "answerSelling" in entry ? entry.answerSelling : entry.answer}</p></details>
          ))}
        </div>
      </section>

      </main>

      <div className="home-wash home-closing">
        <section className="home-shell" aria-labelledby="fechamento-titulo">
          <div className="home-heading">
            <h2 className="home-display" id="fechamento-titulo">{copy.closing.title}</h2>
            <p>{copy.closing.lead}</p>
          </div>
          <ClaimBar />
        </section>
        <footer className="home-shell home-footer">
          <div className="home-footer-about">
            <span className="home-brand">{PRODUCT.name}</span>
            <p>{copy.footer.tagline}</p>
          </div>
          <nav aria-labelledby="rodape-produto">
            <h2 id="rodape-produto">{copy.footer.productTitle}</h2>
            <ul>
              <li><a href="#recursos">{copy.nav.features}</a></li>
              <li><a href="#modelos">{copy.nav.templates}</a></li>
              <li><a href="#planos">{copy.nav.plans}</a></li>
              <li><a href="#duvidas">{copy.nav.faq}</a></li>
            </ul>
          </nav>
          <nav aria-labelledby="rodape-publico">
            <h2 id="rodape-publico">{copy.footer.audienceTitle}</h2>
            <ul>
              <li><Link href="/agencias">{copy.footer.agencies}</Link></li>
              <li><Link href="/profissionais">{copy.footer.professionals}</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="rodape-conta">
            <h2 id="rodape-conta">{copy.footer.accountTitle}</h2>
            <ul>
              <li><Link href={SIGN_UP_PATH}>{copy.nav.signUp}</Link></li>
              <li><Link href={SIGN_IN_PATH}>{copy.nav.signIn}</Link></li>
              <li><Link href="/recuperar-acesso">{copy.footer.recover}</Link></li>
              <li><Link href="/privacidade">{copy.footer.privacy}</Link></li>
            </ul>
          </nav>
        </footer>
      </div>
    </div>
  );
}
