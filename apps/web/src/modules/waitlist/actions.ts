"use server";

import { getWaitlistStore } from "./store";
import type { WaitlistActionState } from "./types";
import { validateWaitlist } from "./validation";

export async function submitWaitlist(_previous: WaitlistActionState, formData: FormData): Promise<WaitlistActionState> {
  const validation = validateWaitlist(formData);
  if (!validation.ok) {
    if (validation.bot) return { status: "success", message: "Cadastro recebido. Se estiver tudo certo, entraremos em contato." };
    return { status: "validation-error", message: "Revise os campos indicados e tente novamente.", errors: validation.errors };
  }
  try {
    await getWaitlistStore().create(validation.signup);
    return { status: "success", message: "Cadastro recebido. Se estiver tudo certo, entraremos em contato sobre o piloto." };
  } catch {
    return { status: "unavailable", message: "Não foi possível guardar seu cadastro agora. Tente novamente em alguns minutos." };
  }
}
