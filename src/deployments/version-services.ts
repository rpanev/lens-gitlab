import type { Service } from "./services";

/** One service as it stands for one version: its image built from it, or its chart. */
export interface VersionService {
  readonly name: string;
  readonly state: "running" | "rolling-out" | "picked-up" | "failed";
  readonly service: Service;
}

const chartStateOf = (service: Service): VersionService["state"] => {
  switch (service.chart?.pending?.stage) {
    case "failed":
      return "failed";
    case "upgrading":
      return "rolling-out";
    case "waiting":
      return "picked-up";
    default:
      return "running";
  }
};

/** The services that run, are rolling out to, or Flux is bringing the build or the chart of one version. */
export const servicesOfVersion = (id: string, services: readonly Service[]): VersionService[] =>
  services.flatMap((service): VersionService[] => {
    const image = (): VersionService[] => {
      if (service.running?.id === id)
        return [{ name: service.name, state: service.rollingOut ? "rolling-out" : "running", service }];
      if (service.pickedUp?.id === id)
        return [{ name: service.name, state: service.pickedUp.stage === "failed" ? "failed" : "picked-up", service }];

      return [];
    };

    // A chart kept in the repository was built from one of its commits, which may not be the one its image was.
    const chart: VersionService[] =
      service.chart?.sourceCommit === id
        ? [{ name: `${service.name} chart`, state: chartStateOf(service), service }]
        : [];

    return [...image(), ...chart];
  });
