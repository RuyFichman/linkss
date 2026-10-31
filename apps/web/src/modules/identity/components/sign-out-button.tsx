import { getCopy } from "@/modules/identity/locale";
import { signOutAction } from "../actions";

/** A form, so sign-out is always a POST (Server Action) and works without JavaScript. */
export async function SignOutButton({ label, next }: { label?: string; next?: string }) {
  const { AUTH_COPY } = await getCopy();
  return (
    <form action={signOutAction}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button type="submit" className="ui-button ui-button-secondary">{label ?? AUTH_COPY.signOut}</button>
    </form>
  );
}
