// How a line is labelled wherever it is only DISPLAYED (detail page, preview, public pages): the name in
// bold with the description underneath, if there is one. Pass the already-resolved name and description
// (lineName / lineDescription) so an old line - null name, text in description - shows as just a name.
export function LineLabel({ name, description }: { name: string; description?: string | null }) {
  const text = description?.trim();
  return (
    <>
      <span className="font-semibold">{name}</span>
      {text && (
        <span className="block text-xs font-normal whitespace-pre-line text-muted-foreground">{text}</span>
      )}
    </>
  );
}
