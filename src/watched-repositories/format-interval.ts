export const formatInterval = (minutes: number) =>
  minutes === 1 ? "Every minute" : minutes === 60 ? "Every hour" : `Every ${minutes} minutes`;
