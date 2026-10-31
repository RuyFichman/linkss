import { HelpCenter, helpMetadata } from "../../ajuda/help-center";

export const metadata = helpMetadata("es-ES");

/** The help center in Spanish (ADR 0022). */
export default function SpanishHelpPage() {
  return <HelpCenter locale="es-ES" />;
}
