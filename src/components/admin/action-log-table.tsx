import Link from "next/link";
import type { AdminActionType, Database } from "@/lib/database.types";

type ActionRow = Database["public"]["Tables"]["admin_actions"]["Row"];

const LABELS: Record<AdminActionType, string> = {
  tier_override: "Tier override",
  subscription_cancel: "Cancel subscription",
  subscription_refund: "Refund",
  resend_confirmation: "Confirmation link",
  password_reset: "Password reset link",
  note: "Note",
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short",
  });
}

// Shared by /admin/log (every account) and the per-account detail page.
// Notes are rows too - their body lives in `reason`, with no old/new.
export function ActionLogTable({
  rows,
  showAccount = true,
}: {
  rows: ActionRow[];
  showAccount?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nothing logged yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">When (UTC)</th>
            {showAccount && <th className="px-3 py-2 font-medium">Account</th>}
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Change</th>
            <th className="px-3 py-2 font-medium">Reason / note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border align-top last:border-0">
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatWhen(r.created_at)}</td>
              {showAccount && (
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/accounts/${r.account_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {r.account_email}
                  </Link>
                </td>
              )}
              <td className="px-3 py-2 whitespace-nowrap font-medium">{LABELS[r.action_type]}</td>
              <td className="px-3 py-2 break-words tabular-nums">
                {r.old_value || r.new_value
                  ? `${r.old_value ?? "—"} → ${r.new_value ?? "—"}`
                  : "—"}
              </td>
              <td className="px-3 py-2 break-words whitespace-pre-wrap">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
