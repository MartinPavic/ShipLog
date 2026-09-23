import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/ship-log", label: "Ship Log" },
  { href: "/settings", label: "Settings" },
];

export function DashboardNav() {
  return (
    <nav className="flex shrink-0 flex-row gap-4 border-b p-4 md:w-56 md:flex-col md:border-b-0 md:border-r">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="text-sm font-medium">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
