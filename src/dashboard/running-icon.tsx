import { Span } from "@k8slens/element-components";
import styles from "./running-icon.module.scss";

/** A run, job or step in progress: a ring with an arc turning round it, in the colour of its status. */
export const RunningIcon = () => (
  <Span $color="primary" className={styles.running}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </Span>
);
