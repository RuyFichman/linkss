import type { Metadata } from "next";
import Link from "next/link";
import { HELP_COPY } from "@/content/pt-BR";
import { PRODUCT } from "@/lib/product";
import { supportEmail } from "@/lib/support";
import { BRAND_CLASS } from "@/ui/brand-font";

export const metadata: Metadata = { title: `${HELP_COPY.title} | ${PRODUCT.name}`, description: HELP_COPY.lead };

const LINK = "inline-flex min-h-11 items-center font-bold text-app-accent underline";

/**
 * Short help center and the support contact. Static: the answers are copy (content/pt-BR.ts) and
 * the one setting it reads (the support address) is read at build time, like every other value
 * on the public marketing pages. Questions are plain headings
 * and paragraphs, so the page works without JavaScript and the browser's own search finds them.
 */
export default function HelpPage() {
  const copy = HELP_COPY;
  const email = supportEmail();
  const sections = [...copy.sections, copy.billing];
  return (
    <main className={`${BRAND_CLASS} py-8 sm:py-16`}>
      <div className="app-shell grid max-w-3xl gap-6">
        <header className="grid gap-3">
          <h1 className="text-3xl font-bold sm:text-4xl">{copy.title}</h1>
          <p className="m-0 leading-7 text-app-muted">{copy.lead}</p>
          <nav aria-label={copy.navLabel}>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
              {sections.map((section) => <li key={section.id}><a className={LINK} href={`#${section.id}`}>{section.title}</a></li>)}
              <li><a className={LINK} href="#contato">{copy.contact.title}</a></li>
            </ul>
          </nav>
        </header>

        {sections.map((section) => (
          <section key={section.id} id={section.id} className="surface-card grid scroll-mt-4 gap-5 p-5 sm:p-8" aria-labelledby={`${section.id}-titulo`}>
            <h2 id={`${section.id}-titulo`} className="text-2xl font-bold">{section.title}</h2>
            {section.items.map((item) => (
              <div key={item.question} className="grid gap-1">
                <h3 className="text-lg font-bold">{item.question}</h3>
                <p className="m-0 leading-7">{item.answer}</p>
              </div>
            ))}
          </section>
        ))}

        <section id="contato" className="surface-card grid scroll-mt-4 gap-4 p-5 sm:p-8" aria-labelledby="contato-titulo">
          <h2 id="contato-titulo" className="text-2xl font-bold">{copy.contact.title}</h2>
          <p className="m-0 leading-7">{email ? copy.contact.withEmail : copy.contact.withoutEmail}</p>
          {email ? <p className="m-0"><a className={`${LINK} break-all`} href={`mailto:${email}`}>{email}</a></p> : null}
          <ul className="m-0 grid list-none gap-1 p-0">
            <li><Link className={LINK} href="/denunciar">{copy.contact.links.report}</Link></li>
            <li><Link className={LINK} href="/app/conta/dados">{copy.contact.links.data}</Link></li>
            <li><Link className={LINK} href="/status">{copy.contact.links.status}</Link></li>
            <li><Link className={LINK} href="/privacidade">{copy.contact.links.privacy}</Link></li>
          </ul>
        </section>

        <p className="m-0"><Link className="ui-button ui-button-secondary" href="/">{copy.back}</Link></p>
      </div>
    </main>
  );
}
