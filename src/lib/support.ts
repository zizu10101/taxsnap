// Where the in-app Help screen sends support questions. One place to change it.
export const SUPPORT_EMAIL = "info@gettaxsnap.ca";

export function supportMailto(email: string = SUPPORT_EMAIL): string {
  return `mailto:${email}`;
}
