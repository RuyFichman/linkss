import type { WaitlistSignup, WaitlistStore } from "./types";

const signups = new Map<string, WaitlistSignup>();
export const memoryWaitlistStore: WaitlistStore = {
  async create(signup) {
    const key = signup.email.toLowerCase();
    if (signups.has(key)) return "duplicate";
    signups.set(key, structuredClone(signup));
    return "created";
  },
};
