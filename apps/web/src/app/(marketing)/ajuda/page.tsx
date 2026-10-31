import { HelpCenter, helpMetadata } from "./help-center";

export const metadata = helpMetadata("pt-BR");

export default function HelpPage() {
  return <HelpCenter locale="pt-BR" />;
}
