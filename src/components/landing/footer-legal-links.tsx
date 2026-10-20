import Link from "next/link";

// The Terms and Privacy links for the public footers. Its own small file so the footer's
// other links component stays untouched.
const linkClass = "font-medium text-foreground underline hover:text-primary";

export function FooterLegalLinks() {
  return (
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      <Link href="/terms" className={linkClass}>
        Terms
      </Link>
      <Link href="/privacy" className={linkClass}>
        Privacy
      </Link>
    </p>
  );
}
