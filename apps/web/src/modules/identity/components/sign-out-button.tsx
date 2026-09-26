import { AUTH_COPY } from "@/content/pt-BR";
import { signOutAction } from "../actions";

/** A form, so sign-out is always a POST (Server Action) and works without JavaScript. */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="ui-button ui-button-secondary">{AUTH_COPY.signOut}</button>
    </form>
  );
}
