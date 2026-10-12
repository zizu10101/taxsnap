import Link from "next/link";

// The footer's site links (FAQ, How-to videos). The name predates the second
// link; it is imported by every marketing page's footer.
const linkClass = "font-medium text-foreground underline hover:text-primary";

export function FooterFaqLink() {
  return (
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      <Link href="/faq" className={linkClass}>
        FAQ
      </Link>
      <Link href="/how-to" className={linkClass}>
        How-to videos
      </Link>
    </p>
  );
}
