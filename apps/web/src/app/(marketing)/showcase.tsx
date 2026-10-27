import Image from "next/image";
import type { ReactNode, CSSProperties } from "react";
import { SocialIcon } from "@/modules/publishing/render/social-icon";
import { THEME_FONT_FAMILY } from "@/modules/themes/fonts";
import { ShowcaseGallery } from "./showcase-gallery";
import "./showcase.css";

const ASSETS = "/images/showcase";
const bodyFont = { fontFamily: THEME_FONT_FAMILY.poppins } as CSSProperties;
const serifFont = { fontFamily: THEME_FONT_FAMILY.lora } as CSSProperties;

function Photo({ name, alt, className = "" }: { name: string; alt: string; className?: string }) {
  return <Image src={`${ASSETS}/${name}.webp`} width={720} height={1080} alt={alt} className={className} sizes="(max-width: 600px) 360px, 260px" loading="lazy" unoptimized />;
}

function Socials({ networks = ["instagram", "pinterest", "youtube"] }: { networks?: ("instagram" | "pinterest" | "youtube" | "tiktok" | "facebook")[] }) {
  return <div className="showcase-socials" aria-hidden="true">{networks.map((network) => <SocialIcon key={network} network={network} />)}</div>;
}

function Tile({ children, note, variant = "" }: { children: ReactNode; note?: string; variant?: string }) {
  return <div className={`showcase-link ${variant}`}><span>{children}</span>{note ? <small>{note}</small> : null}</div>;
}

function PhotographerPage() {
  return <div className="showcase-page showcase-photographer" lang="en" style={serifFont}>
    <Photo name="photographer" alt="Photographer with her camera in an olive garden" className="showcase-photo-cover" />
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">WEDDINGS · ELOPEMENTS · STORIES</p>
      <h4 className="showcase-photo-name">Olivia Hart</h4>
      <p className="showcase-photo-subtitle">P H O T O G R A P H Y</p>
      <p className="showcase-bio">For the wildly in love.<br />Honest stories, beautifully remembered.</p>
      <Socials networks={["instagram", "pinterest"]} />
      <Tile>Let’s tell your story<small>Wedding &amp; elopement enquiries</small></Tile>
      <Tile>Explore the portfolio</Tile>
      <Photo name="wedding" alt="A couple walking through an Italian courtyard" className="showcase-feature-photo" />
      <p className="showcase-photo-caption">Little moments. A lifetime of meaning.</p>
    </div>
  </div>;
}

function CookingPage() {
  return <div className="showcase-page showcase-cooking" lang="en" style={bodyFont}>
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">GOOD FOOD. EVERY DAY.</p>
      <h4 className="showcase-cooking-name" style={serifFont}>the green<br /><em>table.</em></h4>
      <p className="showcase-bio">Plant-based recipes for real life.<br />A little inspiration for your next meal.</p>
      <Socials />
      <Tile variant="showcase-pill">All recipes</Tile>
      <p className="showcase-section-label">ON THE MENU</p>
      <div className="showcase-image-card">
        <Photo name="cooking" alt="Lemon orzo with asparagus, roasted tomatoes and basil" />
        <div><h5>Creamy lemon orzo</h5><p>Your new weeknight favourite.</p></div>
      </div>
      <Tile>Get the weekly recipe letter<small>A little goodness in your inbox.</small></Tile>
      <Tile>The plant-based pantry guide</Tile>
    </div>
  </div>;
}

function CoachPage() {
  return <div className="showcase-page showcase-coach" lang="en" style={bodyFont}>
    <div className="showcase-page-body">
      <Photo name="coach-avatar" alt="Maya Bennett, strength coach" className="showcase-avatar" />
      <h4 className="showcase-coach-name">MAYA BENNETT</h4>
      <p className="showcase-eyebrow">TRAIN WITH PURPOSE.</p>
      <p className="showcase-bio">Build strength. Find your confidence.<br />Coaching that fits your life.</p>
      <Socials networks={["instagram", "youtube", "tiktok"]} />
      <Tile>Let’s work together<small>1:1 ONLINE COACHING</small></Tile>
      <Tile>Your stronger start<small>FREE 7-DAY MOVEMENT GUIDE</small></Tile>
      <div className="showcase-coach-feature">
        <Photo name="coach" alt="A coach sitting in a naturally lit training studio" />
        <div><span>SMALL STEPS.<br />STRONGER YOU.</span></div>
      </div>
      <Tile>Meet your coach</Tile>
    </div>
  </div>;
}

function FarmPage() {
  return <div className="showcase-page showcase-farm" lang="en" style={serifFont}>
    <Photo name="lavender" alt="Lavender fields and a stone barn in the English countryside" className="showcase-farm-cover" />
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">A LITTLE CLOSER TO NATURE</p>
      <h4 className="showcase-farm-name">Willow &amp; Wild</h4>
      <p className="showcase-farm-subtitle">LAVENDER FARM &amp; BOTANICAL GOODS</p>
      <p className="showcase-bio">Slow days, lavender fields &amp; simple pleasures.<br />From our little farm to your home.</p>
      <Socials networks={["instagram", "facebook", "pinterest"]} />
      <Tile>Plan your visit<small>Find your moment of calm.</small></Tile>
      <Tile>Shop the farm collection</Tile>
      <Photo name="botanicals" alt="Lavender oil, handmade soap and fresh lavender sprigs" className="showcase-feature-photo" />
      <p className="showcase-photo-caption">Grown with care. Made to be enjoyed.</p>
    </div>
  </div>;
}

function MusicPage() {
  return <div className="showcase-page showcase-music" lang="en" style={bodyFont}>
    <div className="showcase-page-body">
      <Photo name="musician-avatar" alt="Portrait of artist Nova Reed" className="showcase-avatar" />
      <h4 className="showcase-music-name">NOVA REED</h4>
      <p className="showcase-bio">Songs for the after hours.</p>
      <Socials networks={["instagram", "youtube", "tiktok"]} />
      <Tile>Listen to the new record<small>AFTER HOURS · OUT NOW</small></Tile>
      <div className="showcase-image-card">
        <Photo name="musician" alt="Nova Reed in a blue dress against a turquoise studio backdrop" />
        <div><p className="showcase-eyebrow">THE NEW RECORD</p><h5>After Hours</h5><p>Find it wherever you listen.</p></div>
      </div>
      <Tile>Live dates &amp; tickets</Tile>
      <Tile>Stay in the loop<small>Music, news &amp; little things.</small></Tile>
    </div>
  </div>;
}

/** Original editorial identities, not customer endorsements. Only existing block capabilities. */
export function Showcase() {
  return <ShowcaseGallery entries={[
    { id: "photography", name: "Olivia Hart", category: "Fotografia", description: "Uma presença editorial com fotografia, portfólio e um convite para conversar.", page: <PhotographerPage /> },
    { id: "cooking", name: "The Green Table", category: "Culinária & conteúdo", description: "Receitas em destaque, conteúdo visual e todos os caminhos para acompanhar uma marca.", page: <CookingPage /> },
    { id: "coaching", name: "Maya Bennett", category: "Coaching & bem-estar", description: "Uma identidade marcante para apresentar serviços, compartilhar conteúdo e receber novos contatos.", page: <CoachPage /> },
    { id: "farm", name: "Willow & Wild", category: "Marca & loja", description: "Produtos, história e visitas em uma página com a personalidade do negócio.", page: <FarmPage /> },
    { id: "music", name: "Nova Reed", category: "Música & lançamentos", description: "Uma página para reunir lançamentos, canais de música e datas de apresentações.", page: <MusicPage /> },
  ]} />;
}
