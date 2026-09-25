import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { children: ReactNode; loading?: boolean; variant?: ButtonVariant; }

export function Button({ children, className = "", disabled, loading = false, variant = "primary", ...props }: ButtonProps) {
  return <button className={`ui-button ui-button-${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{loading ? <span aria-hidden="true">●</span> : null}{loading ? "Aguarde…" : children}</button>;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { label: string; children: ReactNode; }
export function IconButton({ label, children, className = "", ...props }: IconButtonProps) {
  return <button className={`ui-button ui-button-secondary ui-icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}
