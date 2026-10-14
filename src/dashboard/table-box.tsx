import { Div } from "@k8slens/element-components";
import type { ReactNode } from "react";

// Lens's tables are as tall as where they are put, so each is given room for its rows, and scrolls past a dozen.
const tableHeight = (rows: number) => 48 * (Math.min(Math.max(rows, 1), 12) + 1);

// Lens's table measures its container when it mounts, and draws no rows into room it gained afterwards:
// a container that grows is a table mounted anew, which keeps the rows it already has.
export const TableBox = ({ rows, children }: { rows: number; children: ReactNode }) => {
  const height = tableHeight(rows);

  return (
    <Div key={height} $style={{ height }}>
      {children}
    </Div>
  );
};
