import Link from "next/link";
import { Camera, FileSpreadsheet, Receipt, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Camera,
    title: "Snap a photo",
    description: "Point your phone at any receipt. That's it.",
  },
  {
    icon: Sparkles,
    title: "AI does the work",
    description:
      "Gemini reads the merchant, total, tax, and category automatically.",
  },
  {
    icon: FileSpreadsheet,
    title: "Export at tax time",
    description: "One click gets you a clean, IRS-friendly spreadsheet.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-lg">
          <Receipt className="h-8 w-8" />
        </div>
        <h1 className="max-w-lg text-4xl font-bold tracking-tight">
          Tax write-offs, sorted the moment you snap the receipt.
        </h1>
        <p className="max-w-md text-muted-foreground">
          TaxSnap is built for painters, handymen, barbers, and every other
          self-employed trade contractor who&apos;d rather be working than
          doing bookkeeping.
        </p>
        <div className="flex gap-3">
          <Button size="lg" nativeButton={false} render={<Link href="/auth" />}>
            Get started free
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="/billing" />}
          >
            See pricing
          </Button>
        </div>
      </section>

      <section className="grid gap-4 px-4 pb-16 sm:grid-cols-3 sm:px-8">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <f.icon className="h-6 w-6 text-primary" />
              <h2 className="font-semibold">{f.title}</h2>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
