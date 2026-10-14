/** Quotes a value as one word for a POSIX shell, so nothing in it is interpreted. */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
