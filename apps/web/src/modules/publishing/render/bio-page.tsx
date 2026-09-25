import Image from "next/image";
import type { CSSProperties } from "react";
import { PRODUCT } from "@/lib/product";
import type { Block, PageDocument } from "@/modules/editor/model";
import { buildWhatsAppUrl, normalizeUrl } from "@/modules/editor/model";

function themeStyle(document: PageDocument): CSSProperties {
  const theme = document.theme;
  return {
    "--page-bg": theme.pageBg, "--page-text": theme.pageText, "--page-muted": theme.pageMuted,
    "--page-font": theme.pageFont, "--page-heading-font": theme.headingFont,
    "--btn-bg": theme.buttonBg, "--btn-text": theme.buttonText, "--btn-border": theme.buttonBg,
    "--btn-radius": `${theme.buttonRadius}px`,
  } as CSSProperties;
}

function safeHref(value: string): string | undefined { const result = normalizeUrl(value); return result.ok ? result.url : undefined; }

function BlockView({ block, buttonStyle }: { block: Block; buttonStyle: PageDocument["theme"]["buttonStyle"] }) {
  if (!block.visible) return null;
  switch (block.type) {
    case "text": return <p className="m-0 leading-7">{block.text}</p>;
    case "link": { const href = safeHref(block.url); return href ? <a className="bio-button" data-style={buttonStyle} href={href}>{block.title}</a> : <span className="bio-button opacity-60" data-style={buttonStyle}>{block.title} — link inválido</span>; }
    case "whatsapp": { const result = buildWhatsAppUrl(block.phone, block.message); return result.ok ? <a className="bio-button" data-style={buttonStyle} href={result.url}>{block.label}</a> : null; }
    case "pix": return <div className="rounded-[var(--btn-radius)] border-2 border-[var(--btn-border)] p-4 text-left"><strong className="block">{block.label}</strong><code className="mt-2 block break-all text-sm">{block.key}</code>{block.paymentUrl && safeHref(block.paymentUrl) ? <a className="mt-2 inline-block font-bold underline" href={safeHref(block.paymentUrl)}>Abrir pagamento no parceiro</a> : null}<small className="mt-2 block text-[var(--page-muted)]">O pagamento acontece fora desta plataforma.</small></div>;
    case "social": return <div className="flex flex-wrap justify-center gap-3">{block.items.map((item) => { const href = safeHref(item.url); return href ? <a key={`${item.network}-${item.url}`} className="min-h-11 rounded-full border-2 border-[var(--btn-border)] px-4 py-3 font-bold capitalize" href={href}>{item.network}</a> : null; })}</div>;
    case "separator": return block.style === "space" ? <div className="h-6" /> : <div aria-hidden="true" className={block.style === "dots" ? "text-center tracking-[0.6em]" : "border-t-2 border-[var(--page-muted)] opacity-40"}>{block.style === "dots" ? "•••" : null}</div>;
    case "image": return <div className="overflow-hidden rounded-[var(--btn-radius)] bg-black/10" style={{ aspectRatio: block.aspectRatio }}><Image src={block.src} alt={block.alt} width={800} height={600} className="h-full w-full object-cover" /></div>;
    case "video": return <div className="grid aspect-video place-items-center rounded-[var(--btn-radius)] border-2 border-[var(--btn-border)] bg-black/5 p-4 text-center"><span><b className="block">Vídeo • {block.provider}</b>{block.title}</span></div>;
    case "form": return <form className="grid gap-3 rounded-[var(--btn-radius)] border-2 border-[var(--btn-border)] p-4" action="#"><strong>{block.title}</strong>{block.fields.map((field) => <label key={field} className="grid gap-1 text-left text-sm font-bold">{field === "name" ? "Nome" : field === "email" ? "E-mail" : field === "phone" ? "Telefone" : "Mensagem"}<input className="min-h-11 rounded-lg border border-current bg-transparent px-3" type={field === "email" ? "email" : "text"} /></label>)}<label className="flex gap-2 text-left text-xs"><input type="checkbox" />{block.consentText}</label><button className="bio-button" data-style={buttonStyle} type="submit">Enviar</button></form>;
  }
}

export function BioPage({ document, preview = false }: { document: PageDocument; preview?: boolean }) {
  return <article className="bio-theme min-h-full w-full px-5 py-10" style={themeStyle(document)}><div className="mx-auto grid w-full max-w-md gap-5 text-center"><header><div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-2 border-[var(--page-text)] text-2xl font-bold" aria-hidden="true">{document.title.slice(0, 1).toUpperCase()}</div><h1 className="mt-4 font-[family-name:var(--page-heading-font)] text-3xl font-bold">{document.title}</h1><p className="mt-2 leading-6 text-[var(--page-muted)]">{document.bio}</p></header><div className="grid gap-3">{document.blocks.map((block) => <BlockView key={block.id} block={block} buttonStyle={document.theme.buttonStyle} />)}</div>{document.plan === "free" ? <p className="mt-4 text-xs text-[var(--page-muted)]">Criado com {PRODUCT.codename}{preview ? " • prévia" : ""}</p> : null}</div></article>;
}
