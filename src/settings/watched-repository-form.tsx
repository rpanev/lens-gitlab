import { Div, Form, Span } from "@k8slens/element-components";
import { PlainButton, PrimaryButton, type SelectOption, SingleSelect, TextInput } from "@k8slens/input-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { checkIntervalsInMinutes } from "../watched-repositories/watched-repository";
import {
  type Notify,
  type Track,
  watchedRepositoryFormInjectable,
} from "../watched-repositories/watched-repository-form.injectable";
import { formatInterval } from "../watched-repositories/format-interval";

const intervalOptions: readonly SelectOption<string>[] = checkIntervalsInMinutes.map((minutes) => ({
  id: String(minutes),
  label: formatInterval(minutes),
}));

const notifyOptions: readonly SelectOption<Notify>[] = [
  { id: "all", label: "When services go live, and of failures" },
  { id: "failures", label: "Of failures only" },
  { id: "off", label: "Never" },
];

const trackOptions: readonly SelectOption<Track>[] = [
  { id: "branch", label: "The commits of a branch" },
  { id: "releases", label: "Releases" },
];

const releaseOptions: readonly SelectOption<"with-prereleases" | "releases-only">[] = [
  { id: "with-prereleases", label: "Releases and pre-releases, such as release candidates" },
  { id: "releases-only", label: "Releases only" },
];

export const WatchedRepositoryForm = observer(({ clusterId }: { clusterId: string }) => {
  const form = useInject(watchedRepositoryFormInjectable)(clusterId);

  return (
    <Form
      $flex={{ direction: "vertical", gap: "m" }}
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <Span $font={{ size: "l", bold: true }}>{form.isEditing ? "Edit project" : "Watch a project"}</Span>

      <Div $flex={{ direction: "vertical", gap: "xs" }}>
        <Span $color="textMuted">Host</Span>
        <TextInput
          placeholder="gitlab.com"
          value={form.host.get()}
          onChange={(event) => form.host.set(event.target.value)}
        />
      </Div>

      <Div $flex={{ direction: "vertical", gap: "xs" }}>
        <Span $color="textMuted">Project</Span>
        <TextInput
          placeholder="group/project"
          value={form.repository.get()}
          onChange={(event) => form.setProject(event.target.value)}
        />
        <Span $color="textMuted" $font={{ size: "xs" }}>
          The path on that host, subgroups included. Pasting a project URL fills the host too.
        </Span>
      </Div>

      <Div $flex={{ direction: "vertical", gap: "xs" }}>
        <Span $color="textMuted">Follow</Span>
        <SingleSelect options={trackOptions} selected={form.track.get()} onSelect={(id) => form.track.set(id)} />
      </Div>

      {form.track.get() === "branch" ? (
        <Div $flex={{ direction: "vertical", gap: "xs" }}>
          <Span $color="textMuted">Branch</Span>
          <TextInput
            placeholder="main"
            value={form.branch.get()}
            onChange={(event) => form.branch.set(event.target.value)}
          />
        </Div>
      ) : (
        <Div $flex={{ direction: "vertical", gap: "xs" }}>
          <Span $color="textMuted">Releases</Span>
          <SingleSelect
            options={releaseOptions}
            selected={form.includePrereleases.get() ? "with-prereleases" : "releases-only"}
            onSelect={(id) => form.includePrereleases.set(id === "with-prereleases")}
          />
          <Span $color="textMuted">Tag pattern (optional)</Span>
          <TextInput
            placeholder="v*"
            value={form.tagPattern.get()}
            onChange={(event) => form.tagPattern.set(event.target.value)}
          />
          <Span $color="textMuted" $font={{ size: "xs" }}>
            Only releases whose tag matches, where * stands for anything: v* or artifact-contract/v*. Empty, every
            release.
          </Span>
        </Div>
      )}

      <Div $flex={{ direction: "vertical", gap: "xs" }}>
        <Span $color="textMuted">Refresh everything while nothing is happening</Span>
        <SingleSelect
          options={intervalOptions}
          selected={String(form.intervalMinutes.get())}
          onSelect={(id) => form.intervalMinutes.set(Number(id))}
        />
      </Div>

      <Div $flex={{ direction: "vertical", gap: "xs" }}>
        <Span $color="textMuted">Notify</Span>
        <SingleSelect options={notifyOptions} selected={form.notify.get()} onSelect={(id) => form.notify.set(id)} />
      </Div>

      {form.error && <Span $color="critical">{form.error}</Span>}

      <Div $flex={{ direction: "horizontal", gap: "s" }}>
        <PrimaryButton type="submit" $disabled={!form.canSubmit}>
          {form.isEditing ? "Save" : "Add"}
        </PrimaryButton>

        {form.isEditing && <PlainButton onClick={form.cancel}>Cancel</PlainButton>}
      </Div>
    </Form>
  );
});
