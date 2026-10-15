# Changelog

What changed in each version of this extension, newest first.

From 0.3.0, a version's notes are grouped the way [Keep a Changelog](https://keepachangelog.com/en/2.0.0/) describes. Older versions stay as they were published.

## 0.3.0

### Added

- **DORA** is a tab in the main tab strip, opened from the **DORA** button on the dashboard. For one watched project over the last 7 days it shows the five software delivery metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate. The latest deploy still shows how its lead time split across CI, Flux or Argo CD, and rollout.

### Security

- The Lens UI package lists its test helper as a production dependency. The extension never loads the Jest parts of it, and a stand-in takes its place, so `is-arrayish`, `fb-watchman` and `bser` are not installed.

## 0.2.0

- A service deployed by image digest, or tagged `latest`, is matched to its commit when the workload carries `org.opencontainers.image.revision`.
- A GitLab answer of 304, meaning nothing changed, no longer counts as the GitLab CLI failing. The last reading stays. An error status GitLab returns is reported as that error.
- **Environments**: one project across the clusters that watch it, in columns ordered dev, then stage, then prod, with the commit or release each one runs.
- GitLab's last successful deployment of an environment, beside the cluster of the same name. **production** also matches a cluster that follows `main`, `master` or `prod`. **Drift** opens the commits and merge requests between the two.
- **Play** on a manual job, after confirming, which starts that job on GitLab.
- **DORA** for a watched project, chosen from the menu: median lead time from commit to running, split into CI, Flux or Argo CD, and rollout, and the change failure rate of the week's deploys. Deploys are remembered on this Lens. A rollout that does not finish, a Flux or Argo CD apply that fails, a rollback, or a hotfix within a day counts as a failure.

## 0.1.0

- The extension is named **GitLabOps** in the navigator, the status bar, and the settings.
- A card at the top of a cluster's dashboard for each watched project: whether the latest merge request into its branch passed, and a link to the repository when that pipeline failed.
- The Ask AI terminal on the dashboard stays folded until it is opened.
- A **GitLab** item under every cluster, opening that cluster's dashboard of the latest commits or releases of each watched project, with the status of their pipelines and whether the cluster already runs them.
- A status bar item for the cluster you are looking at: **Up to date**, **Behind**, **Deploying**, **Failing** or **Unreachable**.
- Notifications when services go live, CI fails, something fails to apply, or GitLab or the cluster cannot be read.
- Per-cluster settings for watched projects, on gitlab.com or a GitLab you host yourself, following a branch or releases.
- A pipeline's jobs, with the end of a failed job's trace, and re-running its failed jobs after confirming.
- Ask AI can say how a cluster stands, list its watched projects, report a project's latest pipelines, and open the dashboard or the settings, from any conversation.
- The GitLab dashboard has its own Ask AI terminal, which can watch a project, change it, or stop watching it.
- A link GitLab returns is opened only when it is a page on the watched host. A sign-in token in a GitLab CLI error is not shown.
