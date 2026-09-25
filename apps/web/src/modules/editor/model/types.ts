export type ProfileStatus = "draft" | "published" | "pending" | "archived";
export type Plan = "free" | "pro" | "agency";
export type BlockType = "link" | "text" | "social" | "whatsapp" | "pix" | "form" | "image" | "video" | "separator";

interface BlockBase {
  id: string;
  type: BlockType;
  visible: boolean;
  valueAction: boolean;
}

export interface LinkBlock extends BlockBase { type: "link"; title: string; url: string; }
export interface TextBlock extends BlockBase { type: "text"; text: string; }
export interface SocialItem { network: "instagram" | "tiktok" | "youtube" | "linkedin"; url: string; }
export interface SocialBlock extends BlockBase { type: "social"; items: SocialItem[]; }
export interface WhatsAppBlock extends BlockBase { type: "whatsapp"; label: string; phone: string; message: string; }
export interface PixBlock extends BlockBase { type: "pix"; label: string; keyType: "cpf" | "cnpj" | "email" | "phone" | "random"; key: string; paymentUrl?: string; }
export interface FormBlock extends BlockBase { type: "form"; title: string; fields: Array<"name" | "email" | "phone" | "message">; consentText: string; }
export interface ImageBlock extends BlockBase { type: "image"; src: string; alt: string; aspectRatio: "1/1" | "4/3" | "16/9"; }
export interface VideoBlock extends BlockBase { type: "video"; title: string; url: string; provider: "youtube" | "vimeo" | "unknown"; }
export interface SeparatorBlock extends BlockBase { type: "separator"; style: "line" | "dots" | "space"; }

export type Block = LinkBlock | TextBlock | SocialBlock | WhatsAppBlock | PixBlock | FormBlock | ImageBlock | VideoBlock | SeparatorBlock;

export interface PageTheme {
  id: string;
  name: string;
  pageBg: string;
  pageText: string;
  pageMuted: string;
  pageFont: string;
  headingFont: string;
  buttonBg: string;
  buttonText: string;
  buttonStyle: "filled" | "outline" | "soft";
  buttonRadius: number;
}

export interface PageDocument {
  id: string;
  workspaceId: string;
  title: string;
  bio: string;
  slug: string;
  status: ProfileStatus;
  plan: Plan;
  blocks: Block[];
  theme: PageTheme;
  publishedAt?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  useCase: string;
  intendedValueAction: string;
  theme: PageTheme;
  seedBlocks: Block[];
}

export interface EditorState {
  document: PageDocument;
  revision: number;
  undoDelete?: { block: Block; index: number };
}

export type EditorAction =
  | { type: "add"; block: Block; index?: number }
  | { type: "update"; block: Block }
  | { type: "move"; blockId: string; direction: "up" | "down" }
  | { type: "duplicate"; blockId: string }
  | { type: "toggle"; blockId: string }
  | { type: "delete"; blockId: string }
  | { type: "undo-delete" }
  | { type: "replace-document"; document: PageDocument };
