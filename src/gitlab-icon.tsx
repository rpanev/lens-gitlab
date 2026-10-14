const px: Record<string, number> = { xs: 12, s: 16, m: 20, l: 24, xl: 32, xxl: 48 };

const sizeOf = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && px[value]) return px[value];

  return px.m;
};

/**
 * A pipeline mark, drawn in currentColor so it follows the surrounding text and the theme.
 * Hand the component itself where a Lens surface takes an Icon.
 */
export const GitlabIcon = ({ $size }: { $size?: unknown }) => {
  const size = sizeOf($size);

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M12 1.8 20.6 6.8v10.4L12 22.2 3.4 17.2V6.8L12 1.8Zm0 2.2L5.4 7.6v8.8L12 20l6.6-3.6V7.6L12 4Z" />
      <path d="M12 7.4 16.2 12 12 16.6 7.8 12 12 7.4Z" />
    </svg>
  );
};
