import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <span className="font-semibold">ShipLog</span>
          <div>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="text-sm font-medium">Sign in</button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <UserButton afterSignOutUrl="/" />
            </Show>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          Stop writing weekly updates
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Generate clean, professional ship logs from your GitHub activity in seconds.
        </p>

        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium">
              Get started free
            </button>
          </SignInButton>
        </Show>

        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium inline-block"
          >
            Go to Dashboard
          </Link>
        </Show>
      </main>
    </div>
  );
}