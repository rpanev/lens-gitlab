import { Div, Span } from "@k8slens/element-components";
import type { VersionEntry } from "../deployments/version-entries";
import type { VersionService } from "../deployments/version-services";
import { type DotColor, StatusDot } from "./status-dot";

const dotColors: Record<VersionService["state"], DotColor> = {
  running: "success",
  "rolling-out": "primary",
  "picked-up": "notice",
  failed: "critical",
};

export const EntryDot = ({ entry }: { entry: VersionEntry }) => (
  <Div $flex={{ direction: "horizontal", gap: "xxs", verticalAlign: "center" }}>
    <StatusDot color={dotColors[entry.state]} />
    <Span>{entry.name}</Span>
  </Div>
);
