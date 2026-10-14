const units = [
  { suffix: "d", seconds: 86_400 },
  { suffix: "h", seconds: 3_600 },
  { suffix: "m", seconds: 60 },
] as const;

/** A short age for a column: "3d", "2h", "5m" or "now". */
export const formatAge = (isoDate: string, now = Date.now()) => {
  const secondsAgo = Math.max(0, (now - new Date(isoDate).getTime()) / 1000);
  const match = units.find(({ seconds }) => secondsAgo >= seconds);

  return match ? `${Math.floor(secondsAgo / match.seconds)}${match.suffix}` : "now";
};
