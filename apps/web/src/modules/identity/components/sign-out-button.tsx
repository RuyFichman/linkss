import { AUTH_COPY } from "@/content/pt-BR";
import { signOutAction } from "../actions";

/** A form, so sign-out is always a POST (Server Action) and works without JavaScript. */
export function SignOutButton({ label = AUTH_COPY.signOut, next }: { label?: string; next?: string }) {
  return (
    <form action={signOutAction}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button type="submit" className="ui-button ui-button-secondary">{label}</button>
    </form>
  );
}
