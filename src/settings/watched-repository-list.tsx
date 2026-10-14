import { Div, Span } from "@k8slens/element-components";
import { DangerButton, PlainButton } from "@k8slens/input-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { watchedRepositoryFormInjectable } from "../watched-repositories/watched-repository-form.injectable";
import { followedLabelOf, hostOf, watchKeyOf } from "../watched-repositories/watched-repository";
import { formatInterval } from "../watched-repositories/format-interval";

export const WatchedRepositoryList = observer(({ clusterId }: { clusterId: string }) => {
  const store = useInject(watchedRepositoriesStoreInjectable)(clusterId);
  const form = useInject(watchedRepositoryFormInjectable)(clusterId);
  const watched = store.all;

  if (!watched) return null;

  return (
    <Div $flex={{ direction: "vertical", gap: "m" }}>
      <Span $font={{ size: "l", bold: true }}>Watched projects</Span>

      {watched.length === 0 && <Span $color="textMuted">No projects are watched for this cluster yet.</Span>}

      {watched.map((watch) => (
        <Div key={watchKeyOf(watch)} $flex={{ direction: "horizontal", gap: "m", verticalAlign: "center" }}>
          <Div $flex={{ direction: "vertical", gap: "xxs" }} $flexChild>
            <Span $font={{ bold: true }}>
              {hostOf(watch) === "gitlab.com" ? watch.repository : `${hostOf(watch)}/${watch.repository}`}
            </Span>
            <Span $color="textMuted">
              {followedLabelOf(watch)} · {formatInterval(watch.intervalMinutes).toLowerCase()}
            </Span>
          </Div>

          <PlainButton onClick={() => form.edit(watch)}>Edit</PlainButton>
          <DangerButton onClick={() => void store.remove(watch)}>Remove</DangerButton>
        </Div>
      ))}
    </Div>
  );
});
