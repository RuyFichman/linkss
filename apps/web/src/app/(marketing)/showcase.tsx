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

function PhotographerPage({ compact = false }: { compact?: boolean }) {
  return <div className="showcase-page showcase-photographer" lang="en" style={serifFont}>
    <Photo name="photographer" alt="Photographer with her camera in an olive garden" className="showcase-photo-cover" />
    <div className="showcase-page-body">
      {!compact ? <p className="showcase-eyebrow">WEDDINGS · ELOPEMENTS · STORIES</p> : null}
      <h4 className="showcase-photo-name">Olivia Hart</h4>
      {!compact ? <p className="showcase-photo-subtitle">P H O T O G R A P H Y</p> : null}
      <p className="showcase-bio">For the wildly in love.<br />Honest stories, beautifully remembered.</p>
      <Socials networks={["instagram", "pinterest"]} />
      <Tile variant={compact ? "home-feature-primary" : ""}>Let’s tell your story{!compact ? <small>Wedding &amp; elopement enquiries</small> : null}</Tile>
      <Tile>Explore the portfolio</Tile>
      <Photo name="wedding" alt="A couple walking through an Italian courtyard" className="showcase-feature-photo" />
      {!compact ? <p className="showcase-photo-caption">Little moments. A lifetime of meaning.</p> : null}
    </div>
  </div>;
}

/** The same illustrative identity as the gallery, sized for the features section. */
export function FeaturePagePreview() {
  return <div className="home-feature-page" aria-hidden="true"><PhotographerPage compact /></div>;
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

function CeramicsPage() {
  return <div className="showcase-page showcase-ceramics" lang="en" style={bodyFont}>
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">OBJECTS FOR SLOW LIVING</p>
      <h4 className="showcase-ceramics-name" style={serifFont}>Sable<br /><em>Studio.</em></h4>
      <p className="showcase-bio">Thoughtfully shaped. Made by hand.<br />Everyday objects, a little less ordinary.</p>
      <Socials networks={["instagram", "pinterest"]} />
      <Photo name="ceramics" alt="Handmade ochre, chalk-white and terracotta ceramic vessels in a sunlit studio" className="showcase-ceramics-photo" />
      <Tile>Shop the latest collection<small>SMALL BATCHES · MADE BY HAND</small></Tile>
      <Tile>Visit the studio</Tile>
    </div>
  </div>;
}

function ArchitecturePage() {
  return <div className="showcase-page showcase-architecture" lang="en" style={bodyFont}>
    <Photo name="architecture" alt="A light-filled living room with a linen sofa, walnut chair and courtyard views" className="showcase-architecture-cover" />
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">INTERIORS · OBJECTS · PLACES</p>
      <h4 className="showcase-architecture-name">FORM<br />&amp; FIELD</h4>
      <p className="showcase-bio">Considered spaces for everyday living.<br />Natural materials. Lasting character.</p>
      <Socials networks={["instagram", "pinterest"]} />
      <Tile>Explore our spaces<small>RESIDENTIAL &amp; EVERYDAY LIVING</small></Tile>
      <Tile>Start a conversation</Tile>
    </div>
  </div>;
}

function FloristPage() {
  return <div className="showcase-page showcase-florist" lang="en" style={serifFont}>
    <Photo name="florist" alt="Burgundy dahlias, blush roses and yellow ranunculus arranged in a plum ceramic vase" className="showcase-florist-cover" />
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">FLOWERS, WITH FEELING.</p>
      <h4 className="showcase-florist-name">Petal <em>Theory</em></h4>
      <p className="showcase-bio">For the everyday extraordinary.<br />Seasonal flowers, arranged with heart.</p>
      <Socials networks={["instagram", "pinterest"]} />
      <Tile>Send a little joy<small>EXPLORE THE SEASONAL BOUQUETS</small></Tile>
      <Tile>Weddings &amp; celebrations</Tile>
      <p className="showcase-photo-caption">A little wild. Always thoughtful.</p>
    </div>
  </div>;
}

function GuesthousePage() {
  return <div className="showcase-page showcase-guesthouse" lang="en" style={serifFont}>
    <Photo name="guesthouse" alt="A white plaster arch and woven lounge chairs on a quiet terrace overlooking the sea" className="showcase-guesthouse-cover" />
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">STAY A LITTLE LONGER</p>
      <h4 className="showcase-guesthouse-name">the salt house.</h4>
      <p className="showcase-bio">A small stay beside the sea.<br />For days that move a little slower.</p>
      <Socials networks={["instagram", "facebook"]} />
      <Tile>Find your slow escape<small>ROOMS &amp; AVAILABILITY</small></Tile>
      <Tile>Take a look around</Tile>
      <p className="showcase-photo-caption">Sea air. Soft mornings. Nothing to rush.</p>
    </div>
  </div>;
}

function CoffeehousePage() {
  return <div className="showcase-page showcase-coffeehouse" lang="en" style={bodyFont}>
    <div className="showcase-page-body">
      <p className="showcase-eyebrow">GOOD COFFEE. GOOD COMPANY.</p>
      <h4 className="showcase-coffeehouse-name" style={serifFont}>Sunday<br /><em>Social</em></h4>
      <p className="showcase-bio">Your daily pause, poured with care.<br />There’s always a seat for you.</p>
      <Socials networks={["instagram", "facebook"]} />
      <div className="showcase-image-card">
        <Photo name="coffeehouse" alt="A flat white in a terracotta cup and a golden croissant on a sunlit cafe table" />
        <div><p>The usual, done beautifully.</p></div>
      </div>
      <Tile>Come by for a coffee<small>MENU, HOURS &amp; DIRECTIONS</small></Tile>
      <Tile>Coffee for your home</Tile>
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
    { id: "ceramics", name: "Sable Studio", category: "Cerâmica & design", description: "Uma vitrine de peças autorais com fotografia de produto, coleção e um convite para conhecer o ateliê.", page: <CeramicsPage /> },
    { id: "architecture", name: "Form & Field", category: "Arquitetura & interiores", description: "Um portfólio de interiores com presença editorial, projetos em destaque e contato para novas conversas.", page: <ArchitecturePage /> },
    { id: "florist", name: "Petal Theory", category: "Flores & celebrações", description: "Arranjos sazonais e celebrações apresentados com uma identidade floral expressiva e caminhos claros para encomendar.", page: <FloristPage /> },
    { id: "guesthouse", name: "The Salt House", category: "Hospedagem & experiências", description: "Uma pequena hospedagem reúne sua atmosfera, os quartos e o acesso à disponibilidade em uma página acolhedora.", page: <GuesthousePage /> },
    { id: "coffeehouse", name: "Sunday Social", category: "Café & encontros", description: "Uma presença calorosa para um café de bairro, com cardápio, horários, localização e coleção de cafés.", page: <CoffeehousePage /> },
  ]} />;
}
