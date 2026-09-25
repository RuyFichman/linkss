export type WaitlistVariant = "neutral" | "agencies" | "professionals";
export type WaitlistSegment = "agency" | "freelancer" | "creator" | "local-business" | "other";

export interface WaitlistSignup {
  name: string;
  email: string;
  whatsapp?: string;
  segment: WaitlistSegment;
  managedProfiles: string;
  currentTool?: string;
  willingnessToPay: string;
  pilotInterest: boolean;
  consent: true;
  variant: WaitlistVariant;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
}

export interface WaitlistStore {
  create(signup: WaitlistSignup): Promise<"created" | "duplicate">;
}

export interface WaitlistActionState {
  status: "idle" | "success" | "validation-error" | "unavailable";
  message?: string;
  errors?: Record<string, string>;
}
