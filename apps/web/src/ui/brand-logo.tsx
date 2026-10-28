import Image from "next/image";
import { PRODUCT } from "@/lib/product";

/** Outlined wordmark: identical lettering in every shell, without an extra font download. */
export function BrandLogo() {
  return <Image className="brand-logo" src="/brand/linkfav-logo.svg" width={293} height={72} alt={PRODUCT.name} unoptimized />;
}
