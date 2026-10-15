/** One line of a job's trace, as shown: what it says, and whether it is an error or a warning. */
export interface LogLine {
  readonly text: string;
  readonly kind: "error" | "warning" | "plain";
}

const colours = /\u001b\[[0-9;]*[A-Za-z]/g;
// GitLab prefixes a line with a timestamp and a stream marker when timestamps are on: "2026-…Z 00O ".
const timestamp = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+\d{2}O[+]?\s?/;
const section = /^section_(?:start|end):\d+:[^\r]*/;
// Kubernetes' tools log in klog's format: "E1002 14:09:14.046485   12195 memcache.go:381] ...".
const klog = /^([EFW])\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+ [^\]\s]+\] /;

/** The last lines of a failed job's trace, cleaned of the markers GitLab's own log view hides. */
export const failedLogLinesOf = (output: string, max = 50): LogLine[] =>
  output
    .split("\n")
    .map((line) => line.replace(colours, "").replaceAll("\r", "").replace(timestamp, "").trimEnd())
    .filter((text) => text.trim() !== "" && !section.test(text.trim()))
    .slice(-max)
    .map((text): LogLine => {
      const trimmed = text.trim();

      if (/^ERROR:/i.test(trimmed) || /^FATAL:/i.test(trimmed)) return { text: trimmed, kind: "error" };
      if (/^WARNING:/i.test(trimmed) || /^WARN:/i.test(trimmed)) return { text: trimmed, kind: "warning" };

      const logged = trimmed.match(klog);

      return { text: trimmed, kind: logged ? (logged[1] === "W" ? "warning" : "error") : "plain" };
    });
