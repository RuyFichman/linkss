import { domainsSignerFromEnv } from "@/modules/domains/config";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Schibsted_Grotesk } from "next/font/google";
import { marketingCopy } from "@/content/marketing";
import type { HomeCopy } from "@/content/types";
import { publicAddressLabel } from "@/lib/app-url";
import { DEFAULT_LOCALE, HELP_PATH, HOME_PATH, LOCALE_CODE, SIGN_IN_PATH, SIGN_UP_PATH, type Locale } from "@/lib/locale";
import { BrandLogo } from "@/ui/brand-logo";
import "./home.css";
import { PlanComparison, Pricing } from "./pricing";
import { FeaturePagePreview, HeroPagePreviews, Showcase } from "./showcase";

const displayFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-home-display", display: "swap" });


type PhoneKey = keyof HomeCopy["phones"];
type PhoneLook = { bg: string; text: string; muted: string; button: string; buttonText: string; radius: string; cover: string; outline?: boolean };

// Illustrative pages drawn in CSS: invented names, no customer content and no image requests.
const PHONE_LOOKS: Record<PhoneKey, PhoneLook> = {
  creator: { bg: "#f1f1f4", text: "#1d1d28", muted: "#5b6072", button: "#ffffff", buttonText: "#1d1d28", radius: "0.9rem", cover: "linear-gradient(160deg, #f6b26b, #d9534f 55%, #5b3a8c)" },
  local: { bg: "#f5efe5", text: "#231f1a", muted: "#5e574e", button: "#1f5b49", buttonText: "#ffffff", radius: "1rem", cover: "linear-gradient(150deg, #8fc79a, #1f5b49)" },
  shop: { bg: "#0f3f5c", text: "#ffffff", muted: "#cfe3ee", button: "#35c3d6", buttonText: "#06202c", radius: "0.5rem", cover: "linear-gradient(150deg, #35c3d6, #f29b4b)" },
  service: { bg: "#eef5f2", text: "#16352d", muted: "#49665e", button: "#225e50", buttonText: "#ffffff", radius: "0.6rem", cover: "linear-gradient(150deg, #b7dccf, #225e50)", outline: true },
  event: { bg: "#100f12", text: "#ffffff", muted: "#c9c5ce", button: "#c21870", buttonText: "#ffffff", radius: "0.25rem", cover: "linear-gradient(150deg, #c21870, #3b1d6e)" },
};

function initials(name: string): string {
  return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function PhoneMock({ phone, copy }: { phone: PhoneKey; copy: HomeCopy["phones"][PhoneKey] }) {
  const look = PHONE_LOOKS[phone];
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
function ClaimBar({ copy, signUpHref }: { copy: HomeCopy["hero"]; signUpHref: string }) {
  const [host] = publicAddressLabel("").split("/");
  return (
    <div className="home-claim">
      <p className="home-claim-address m-0">{host}/<span>{copy.addressPlaceholder}</span></p>
      <Link className="home-cta" href={signUpHref}>{copy.cta}</Link>
    </div>
  );
}

/**
 * The marketing home, in Portuguese at `/` and in Spanish at `/es` (ADR 0022). The Spanish home
 * marks its subtree with `lang="es"` (the document element stays pt-BR: there is one root layout),
 * shows the prices of its market and leaves out the pages that exist only in Portuguese.
 */
export function Home({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const copy = marketingCopy(locale).home;
  const portuguese = locale === "pt-BR";
  const signUpHref = SIGN_UP_PATH[locale];
  const otherLocale: Locale = portuguese ? "es-ES" : "pt-BR";
  // Pages that exist only in Portuguese say so to a Spanish reader.
  const portugueseOnly = portuguese ? undefined : LOCALE_CODE["pt-BR"];
  // Read at build time: configuring custom domains needs a redeploy, like every other value this static page shows.
  const customDomains = domainsSignerFromEnv() !== null;
  const faqAnswer = (entry: (typeof copy.faq.items)[number]) => customDomains && "answerDomains" in entry && entry.answerDomains ? entry.answerDomains : entry.answer;
  return (
    <div className={`home ${displayFont.variable}`} lang={portuguese ? undefined : LOCALE_CODE[locale]}>
      <header className="home-shell home-header">
          <Link className="home-brand" href={HOME_PATH[locale]}><BrandLogo /></Link>
          <nav className="home-nav" aria-label={copy.nav.label}>
            <a href="#recursos">{copy.nav.features}</a>
            <a href="#modelos">{copy.nav.templates}</a>
            <a href="#planos">{copy.nav.plans}</a>
            <a href="#duvidas">{copy.nav.faq}</a>
          </nav>
          <div className="home-header-actions">
            <Link className="home-signin" href={SIGN_IN_PATH[locale]}>{copy.nav.signIn}</Link>
            <Link className="home-cta" href={signUpHref}>{copy.nav.signUp}</Link>
          </div>
      </header>

      <main id="conteudo">
        <div className="home-wash home-hero-wash">
          <section className="home-shell home-hero">
            <div>
              <p className="home-badge m-0"><span className="home-badge-dot" aria-hidden="true" />{copy.hero.badge}</p>
              <h1 className="home-display">{copy.hero.title}</h1>
              <p className="home-hero-lead">{copy.hero.lead}</p>
              <ClaimBar copy={copy.hero} signUpHref={signUpHref} />
            </div>
            <div className="home-fan">
              <HeroPagePreviews />
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
        <Showcase locale={locale} />
        <p className="home-center m-0"><Link className="home-cta" href={signUpHref}>{copy.templates.cta}</Link></p>
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
          <div className="home-editor-preview">{copy.editor.previewLabel}<PhoneMock phone="service" copy={copy.phones.service} /></div>
        </div>
      </section>

      <section className="home-section home-shell" id="recursos" aria-labelledby="recursos-titulo">
        <div className="home-heading">
          <h2 className="home-display" id="recursos-titulo">{copy.features.title}</h2>
          <p>{copy.features.lead}</p>
        </div>
        <div className="home-features">
          <div className="home-features-phone"><FeaturePagePreview /></div>
          <ul className="home-features-list">
            {copy.features.items.map((feature) => (
              <li key={feature.title}><h3 className="home-display">{feature.title}</h3><p>{feature.body}</p></li>
            ))}
          </ul>
        </div>
      </section>

      <Pricing customDomains={customDomains} locale={locale} />
      <PlanComparison customDomains={customDomains} locale={locale} />

      <section className="home-section home-shell" id="duvidas" aria-labelledby="duvidas-titulo">
        <div className="home-heading">
          <h2 className="home-display" id="duvidas-titulo">{copy.faq.title}</h2>
          <p>{copy.faq.lead}</p>
        </div>
        <div className="home-faq">
          {copy.faq.items.map((entry) => (
            <details key={entry.question}><summary>{entry.question}</summary><p>{faqAnswer(entry)}</p></details>
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
          <ClaimBar copy={copy.hero} signUpHref={signUpHref} />
        </section>
        <footer className="home-shell home-footer">
          <div className="home-footer-about">
            <span className="home-brand"><BrandLogo /></span>
            <p>{copy.footer.tagline}</p>
            <nav aria-label={copy.footer.languageTitle}>
              <ul>
                <li><Link href={HOME_PATH[otherLocale]} hrefLang={LOCALE_CODE[otherLocale]} lang={LOCALE_CODE[otherLocale]}>{copy.footer.otherLanguage}</Link></li>
              </ul>
            </nav>
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
          {/* The waitlist pages and account recovery exist only in Portuguese. */}
          {portuguese ? (
            <nav aria-labelledby="rodape-publico">
              <h2 id="rodape-publico">{copy.footer.audienceTitle}</h2>
              <ul>
                <li><Link href="/agencias">{copy.footer.agencies}</Link></li>
                <li><Link href="/profissionais">{copy.footer.professionals}</Link></li>
              </ul>
            </nav>
          ) : null}
          <nav aria-labelledby="rodape-conta">
            <h2 id="rodape-conta">{copy.footer.accountTitle}</h2>
            <ul>
              <li><Link href={signUpHref}>{copy.nav.signUp}</Link></li>
              <li><Link href={SIGN_IN_PATH[locale]}>{copy.nav.signIn}</Link></li>
              {portuguese ? <li><Link href="/recuperar-acesso">{copy.footer.recover}</Link></li> : null}
              <li><Link href="/privacidade" hrefLang={portugueseOnly}>{copy.footer.privacy}</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="rodape-ajuda">
            <h2 id="rodape-ajuda">{copy.footer.helpTitle}</h2>
            <ul>
              <li><Link href={HELP_PATH[locale]}>{copy.footer.help}</Link></li>
              {/* /precos shows the catalogue in reais; the Spanish home points to its own plans. */}
              <li>{portuguese ? <Link href="/precos">{copy.footer.pricing}</Link> : <a href="#planos">{copy.footer.pricing}</a>}</li>
              <li><Link href="/status">{copy.footer.status}</Link></li>
            </ul>
          </nav>
        </footer>
      </div>
    </div>
  );
}
