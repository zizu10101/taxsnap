// How a document is identified in lists and headers: "Client · Job name". A client can have several
// jobs, so the client name alone doesn't say which job a document is for. The job part is left out
// when no job is linked. Pure, so every list / header / portal row words it the same way.

export function documentLabel(
  clientName: string | null | undefined,
  jobName: string | null | undefined,
  noClient = "No client",
): string {
  const client = clientName?.trim() || noClient;
  const job = jobName?.trim();
  return job ? `${client} · ${job}` : client;
}
