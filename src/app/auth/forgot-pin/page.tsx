import type { Metadata } from "next";
import { ForgotPinForm } from "./forgot-pin-form";

export const metadata: Metadata = {
  title: "Reset your Manager PIN — TaxSnap",
};

export default function ForgotPinPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <ForgotPinForm />
    </main>
  );
}
