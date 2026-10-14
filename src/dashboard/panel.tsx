import { Div, type DivProps, Span } from "@k8slens/element-components";
import type { ReactNode } from "react";

interface PanelProps extends Omit<DivProps, "title"> {
  readonly heading?: ReactNode;
  /** Shown at the far end of the title, such as when the data was checked. */
  readonly aside?: ReactNode;
}

/** A framed block of the dashboard, the way Lens's own dashboards frame theirs. */
export const Panel = ({ heading, aside, children, ...rest }: PanelProps) => (
  <Div
    $flex={{ direction: "vertical", gap: "l" }}
    $padding="xl"
    $backgroundColor="backgroundSecondary"
    $border={{ color: "borderPrimary", width: "xxs", radius: "m" }}
    {...rest}
  >
    {(heading || aside) && (
      <Div $flex={{ direction: "horizontal", gap: "m", verticalAlign: "center" }}>
        <Span $font={{ size: "xl" }} $flexChild>
          {heading}
        </Span>
        {aside && <Span $color="textMuted">{aside}</Span>}
      </Div>
    )}
    {children}
  </Div>
);
