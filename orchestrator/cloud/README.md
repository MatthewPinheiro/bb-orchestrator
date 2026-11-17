# Cloud tab

The Orchestrator's **Cloud** tab (formerly the separate Cloud Switch plugin) shows and swaps the active AWS profile and gcloud configuration on a machine. It also logs you in to them and shows the Entra PIM group that gates each one.

- **See** every AWS profile in your AWS config and every gcloud configuration, with its environment (dev, prod or unknown), its login state and identity, and the PIM groups that gate it.
- **Swap** by setting one bb machine variable: `AWS_PROFILE` or `CLOUDSDK_ACTIVE_CONFIG_NAME`. New threads, terminals and commands pick it up. Off removes it. Your AWS config file is never written.
- **Log in** in a bb terminal on that machine. AWS uses the SSO device-code flow, and the page shows the link and the code. GCP runs the workforce login, sets the project, then logs in Application Default Credentials (ADC).
- **Prod is never one click.** Use and Log in on a prod target, or on one whose environment is unknown, ask again and name the target. The machine's side of the plugin enforces this, so the page alone can't skip it. A page view never runs `sts` for a prod profile, because that would fetch its role credentials.

The same core ships as a `cloud` CLI (`cloud ls`, `cloud use aws <profile>`, `cloud off gcp`, `cloud login gcp dev`, `cloud whoami`, `cloud --help`).

## Turning it on

It comes with the Orchestrator plugin, and the tab is always there. Until the machine has a config file (below), the tab says which path it looked for and what to put there. It also needs the `aws` CLI v2 and/or `gcloud` on the machine.

## Config file

Cloud Switch decides whether a target is dev or prod, and which PIM groups gate it, from a JSON file on the machine. The default path is `~/.config/bb-cloud-switch/config.json`. To use another path, set the Orchestrator's **Cloud tab config file** setting, or for the CLI, `CLOUD_SWITCH_CONFIG`.

If the file is missing, the Cloud tab shows only that message (a CLI call treats every account and project counts as "env unknown", so every use and login asks you to confirm). The tab ignores an invalid file in the same way and shows what is wrong with it.

```sh
mkdir -p ~/.config/bb-cloud-switch && chmod 700 ~/.config/bb-cloud-switch
cp config.example.json ~/.config/bb-cloud-switch/config.json && chmod 600 ~/.config/bb-cloud-switch/config.json
```

`config.example.json`:

```json
{
  "aws": {
    "accounts": [
      {
        "id": "111111111111",
        "env": "dev",
        "pim": {
          "Engineers": [
            { "group": "Example PIM group", "assignment": "active", "permissions": "Dev services" }
          ]
        }
      },
      {
        "id": "222222222222",
        "env": "prod",
        "pim": {
          "Engineers-Prod": [
            { "group": "Example PIM group (prod)", "assignment": "eligible", "approval": true, "maxDuration": "2 hours", "permissions": "Prod services" }
          ]
        }
      }
    ],
    "configPaths": ["/etc/acme/aws/{user}/config"]
  },
  "gcp": {
    "projects": [
      {
        "id": "acme-dev",
        "env": "dev",
        "configuration": "dev",
        "pim": [
          { "group": "Example PIM group (GCP dev)", "assignment": "eligible", "maxDuration": "8 hours", "permissions": "Editor" }
        ]
      },
      {
        "id": "acme-prod",
        "env": "prod",
        "configuration": "prod",
        "pim": [
          { "group": "Example PIM group (GCP prod)", "assignment": "eligible", "approval": true, "maxDuration": "2 hours", "permissions": "Editor" }
        ]
      }
    ],
    "loginConfig": "~/.config/gcloud/acme-login-config.json"
  },
  "links": [
    { "label": "Entra PIM: My roles", "url": "https://portal.azure.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/~/aadgroup" },
    { "label": "My Apps", "url": "https://myapps.microsoft.com" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `aws.accounts[]` | `id` (12-digit account id), `env` (`dev` or `prod`), and `pim`: a map from `sso_role_name` to the PIM groups that gate that role. |
| `aws.configPaths` | Optional. AWS config files to try, in order, when `AWS_CONFIG_FILE` is unset. The first one that exists wins; otherwise `~/.aws/config`. |
| `gcp.projects[]` | `id` (project id), `env`, an optional `configuration` (the name of a gcloud configuration Cloud Switch offers for it and creates on first use), and `pim` (the groups that gate it). |
| `gcp.loginConfig` | Optional. The workforce login config `gcloud` logs in with. The Orchestrator's **Cloud tab: GCP login config** setting and `CLOUD_SWITCH_GCP_LOGIN_CONFIG` take precedence. The fallback is `~/.config/cloud-switch/gcp-login-config.json`. |
| `links[]` | Optional. `label` and `url` (http or https) for buttons on the page and lines in `cloud --help`, for example your PIM activation page. |

Each PIM group has these fields:
- `group` and `assignment` are required. `assignment` is `active` (always on) or `eligible` (you activate it in PIM first).
- `approval` (default `false`), `maxDuration` (for example `"8 hours"`, default `null`) and `permissions` (free text) are optional.
- `inferred: true` marks a best guess.

In paths, `~/` expands to the home directory and `{user}` to the user name. An account or project the file doesn't list is "env unknown" and is gated like prod.

## Privacy

Nothing leaves the machine. Cloud Switch reads the following:
- your AWS config, for profiles only (no secrets);
- `aws sts get-caller-identity`;
- gcloud's configuration and account lists;
- the date on the ADC file, without opening it;
- its own config file.

It never opens the AWS SSO cache, an AWS credentials file or gcloud's credential databases. It never runs a command that prints a token. Any CLI text it shows or logs is redacted first.

It keeps one record of what it set in `~/.local/state/cloud-switch/machine-env.json`, with mode 0600, because bb masks machine variable values. It sends no telemetry and makes no network calls of its own; only `aws` and `gcloud` contact their clouds.

## Development

Its tests run with the Orchestrator's (`npm test` in `orchestrator/`), against fake aws, gcloud and bb in a sandbox under `cloud/.scratch/`.
