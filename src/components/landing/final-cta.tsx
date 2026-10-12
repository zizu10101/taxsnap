import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InstallPromptCards } from "@/components/install-prompt-cards";

export function FinalCta() {
  return (
    <section className="w-full bg-[#c2410c] text-[#fff7ed]">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-4 py-12 text-center sm:px-8">
        <div className="flex flex-col items-center gap-4">
          <h2 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ready to stop doing bookkeeping at night?
          </h2>
          <Button
            size="lg"
            className="bg-[#fff7ed] text-[#c2410c] hover:bg-white"
            nativeButton={false}
            render={<Link href="/auth" />}
          >
            Get started free
          </Button>
        </div>
        <InstallPromptCards embedded />
      </div>
    </section>
  );
}
