import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h1>
        {description ? (
          <p className="text-sm leading-6 text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
