import { Span } from "@k8slens/element-components";

export type DotColor = "success" | "primary" | "notice" | "critical" | "grey60";

export const StatusDot = ({ color }: { color: DotColor }) => (
  <Span $size="xs" $backgroundColor={color} $style={{ borderRadius: "50%", flexShrink: 0 }} />
);
