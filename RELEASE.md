# Release process

This repo ships end users a pre-patched `app.asar` as a downloadable
release asset, so nobody has to install Node or run `patch_asar.js`
locally. The build happens on GitHub Actions (`.github/workflows/release.yml`)
and is triggered by pushing a `v*` tag.

Because the workflow rebuilds `app.asar` from the pristine v1.0.8
`app.asar` (a proprietary vendor binary that cannot be committed to
this public repo), the CI pulls that file from a **private "vendor"
repo** you control. This document covers the one-time setup and the
per-release checklist.

---

## One-time setup

### 1. Create the private vendor repo

Create a private repo on GitHub, e.g. `luanveras3/matrixblock-r4-bak`.
It exists only to host the original `app.asar` as a release asset —
no source, no history, just the binary.

### 2. Upload the pristine `app.asar`

1. From a clean v1.0.8 install, grab `C:\matrixblock-r4\resources\app.asar`.
2. In the private repo, create a release with tag `v1.0.8`.
3. Attach the `app.asar` file (keep the filename `app.asar`).

If a newer upstream version ships later (say v1.0.9), add a new
release in the private repo with tag `v1.0.9` and update the
`BAK_TAG` variable below — the workflow will pick it up on the next
tag push.

### 3. Create a fine-grained Personal Access Token

The public workflow needs read access to the private repo. GitHub's
default `GITHUB_TOKEN` is scoped to the current repo only, so a PAT
is required.

1. https://github.com/settings/personal-access-tokens/new
2. **Resource owner:** your user (`luanveras3`).
3. **Repository access:** _Only select repositories_ → pick
   `matrixblock-r4-bak`.
4. **Permissions:** _Repository permissions_ → **Contents: Read-only**.
5. Set a long expiration (e.g. 1 year) and generate.
6. Copy the token — you won't see it again.

### 4. Configure the public fork

On `luanveras3/matrixblock-r4-astrogenius`, go to
**Settings → Secrets and variables → Actions**.

**Secrets** tab, click **New repository secret**:

| Name              | Value                             |
| ----------------- | --------------------------------- |
| `BAK_REPO_TOKEN`  | The PAT from step 3               |

**Variables** tab, click **New repository variable** three times:

| Name        | Value                                  |
| ----------- | -------------------------------------- |
| `BAK_REPO`  | `luanveras3/matrixblock-r4-bak`        |
| `BAK_TAG`   | `v1.0.8`                               |
| `BAK_ASSET` | `app.asar`                             |

Variables (not secrets) are used because they aren't sensitive and
show up clearly in the workflow logs when debugging.

---

## Cutting a release

Once setup is done, releasing is a two-command dance:

```powershell
git tag v3.4-stable
git push origin v3.4-stable
```

The workflow will:

1. Check out the fork at the tagged commit.
2. Download the pristine `app.asar` from the private vendor repo.
3. Run `patch_asar.js` against it (using env-var-driven paths).
4. Create a GitHub release for the tag (with auto-generated notes)
   and attach the patched `app.asar`.

Watch the run under the **Actions** tab. On success, the release page
at `github.com/luanveras3/matrixblock-r4-astrogenius/releases/tag/v3.4-stable`
will show `app.asar` as a downloadable asset.

End users then:

1. Have a v1.0.8 install at `C:\matrixblock-r4\` (from the vendor).
2. Download the release's `app.asar`.
3. Drop it into `C:\matrixblock-r4\resources\app.asar` (replacing
   the original — no Node, no git, no terminal).

---

## Rebuilding without cutting a new tag

If you need to rebuild an existing release (say you fixed a source
file but the version number stays the same), delete the release's
`app.asar` asset from the GitHub UI and re-push the tag:

```powershell
git tag -d v3.4-stable
git push origin :refs/tags/v3.4-stable
git tag v3.4-stable
git push origin v3.4-stable
```

The workflow's `--clobber` flag also lets you re-run the workflow
manually against an existing tag via the Actions tab if desired.

---

## Troubleshooting

**`repo variable BAK_REPO not set`** — you configured secrets instead
of variables (or vice versa). Both are needed: `BAK_REPO_TOKEN` is a
**secret**, the three `BAK_*` names are **variables**.

**`gh: release not found`** — the tag `BAK_TAG` doesn't exist in the
private repo, or the PAT can't see it. Verify the PAT has
`Contents: Read` on the vendor repo and that the release is
published (not draft).

**Patcher fails with `Cannot find … in header`** — the pristine
`app.asar` in the vendor repo is from a different upstream version
than what `app_src/` was built against. Rebuild `app_src/` against
the new vendor version, or point `BAK_TAG` back to the matching one.

**Release created but no asset attached** — the "Publish patched
app.asar" step failed. Check the run log; most common cause is that
`GITHUB_TOKEN` doesn't have `contents: write` (make sure the
workflow's `permissions:` block wasn't stripped).

---

## Why not distribute the whole installer?

The upstream `MATRIXblock Mini R4.exe` and the `resources/app.asar.unpacked/`
native modules are unmodified proprietary vendor code. Redistributing
those isn't ours to do. Distributing only the patched `app.asar` —
which is derived from the vendor's file plus our own source edits —
sits in the same territory as any Electron mod that ships an asar
overlay: end users still need a legitimate vendor install to run it.
