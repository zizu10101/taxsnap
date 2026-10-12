import Link from "next/link";

export function FooterFaqLink() {
  return (
    <p>
      <Link
        href="/faq"
        className="font-medium text-foreground underline hover:text-primary"
      >
        FAQ
      </Link>
    </p>
  );
}
