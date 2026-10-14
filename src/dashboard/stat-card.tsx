import { Div, Span } from "@k8slens/element-components";
import type { ReactNode } from "react";
import { Panel } from "./panel";

interface StatCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly value: ReactNode;
  readonly label: string;
}

export const StatCard = ({ icon, title, value, label }: StatCardProps) => (
  <Panel $flexChild>
    <Div $flex={{ direction: "horizontal", gap: "m", verticalAlign: "center" }}>
      {icon}
      <Span $font={{ size: "xl" }}>{title}</Span>
    </Div>
    <Div $flex={{ direction: "horizontal", gap: "s", verticalAlign: "bottom" }}>
      <Span $font={{ size: "xxl" }}>{value}</Span>
      <Span $color="textMuted">{label}</Span>
    </Div>
  </Panel>
);
