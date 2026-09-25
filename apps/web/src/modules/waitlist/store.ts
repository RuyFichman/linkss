import "server-only";
import { memoryWaitlistStore } from "./memory-store";
import { createSupabaseWaitlistStore } from "./supabase-store";
import type { WaitlistStore } from "./types";

export function getWaitlistStore(): WaitlistStore {
  const configured = process.env.WAITLIST_STORE;
  if (configured === "supabase") return createSupabaseWaitlistStore();
  if (configured === "memory" || (!configured && process.env.NODE_ENV !== "production")) return memoryWaitlistStore;
  throw new Error("Waitlist store unavailable.");
}
