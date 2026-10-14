# Changelog

What changed in each version of this extension, newest first.

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
