import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
        Outreach
      </h1>
      <p className="max-w-2xl text-base leading-7 text-[var(--muted)]">
        Phase 1 authentication is available. Create an account, verify your
        email, and sign in to the protected application shell.
      </p>
      <ul className="flex flex-wrap gap-4 text-sm">
        <li>
          <Link href="/register" className="underline-offset-2 hover:underline">
            Register
          </Link>
        </li>
        <li>
          <Link href="/login" className="underline-offset-2 hover:underline">
            Sign in
          </Link>
        </li>
      </ul>
    </div>
  );
}
