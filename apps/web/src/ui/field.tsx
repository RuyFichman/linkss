import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> { error?: string; hint?: string; id: string; label: string; }
export function TextField({ error, hint, id, label, className = "", ...props }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className="ui-field"><label htmlFor={id}>{label}</label><input className={`ui-input ${className}`} id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props} />{hint ? <p className="ui-hint" id={`${id}-hint`}>{hint}</p> : null}{error ? <p className="ui-error" id={`${id}-error`} role="alert">{error}</p> : null}</div>;
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> { error?: string; hint?: string; id: string; label: string; }
export function TextAreaField({ error, hint, id, label, className = "", ...props }: TextAreaFieldProps) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className="ui-field"><label htmlFor={id}>{label}</label><textarea className={`ui-textarea ${className}`} id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props} />{hint ? <p className="ui-hint" id={`${id}-hint`}>{hint}</p> : null}{error ? <p className="ui-error" id={`${id}-error`} role="alert">{error}</p> : null}</div>;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> { children: ReactNode; error?: string; hint?: string; id: string; label: string; }
export function SelectField({ children, error, hint, id, label, className = "", ...props }: SelectFieldProps) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className="ui-field"><label htmlFor={id}>{label}</label><select className={`ui-select ${className}`} id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props}>{children}</select>{hint ? <p className="ui-hint" id={`${id}-hint`}>{hint}</p> : null}{error ? <p className="ui-error" id={`${id}-error`} role="alert">{error}</p> : null}</div>;
}
