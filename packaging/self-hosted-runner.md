# The self-hosted macOS runner

The macOS jobs in `.github/workflows/build.yml` (the app for Apple Silicon and Intel, and the macOS
CLI) run on our own Mac mini instead of GitHub's macOS runners. The runner has the labels
`self-hosted, macOS, ARM64, mac-server`. Windows and Linux still build on GitHub.

The Mac needs no Xcode (the Command Line Tools are enough), no Homebrew packages and no admin
rights for builds: the workflow installs Node, pnpm and Rust (rustup, in the runner user's home)
itself. The four macOS jobs run one after another on the single runner.

## Setup (once)

On the Mac, as the user the runner runs as (logged in at the console, so codesign can use a
keychain):

```sh
# 1. The runner (GitHub → Settings → Actions → Runners → New self-hosted runner shows the current
#    version and a registration token; the token is valid for an hour).
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -fsSLO https://github.com/actions/runner/releases/download/v<version>/actions-runner-osx-arm64-<version>.tar.gz
tar xzf actions-runner-osx-arm64-<version>.tar.gz
./config.sh --url https://github.com/devileya/DevCat --token <token> \
  --name mac-server --labels mac-server --work _work --unattended
./svc.sh install && ./svc.sh start      # a LaunchAgent: starts when this user logs in

# 2. Trust DevCat's self-signed certificate for code signing (needs the admin password once).
#    Without it codesign still signs, but the signature would name the certificate as the leaf
#    instead of the root, unlike earlier releases, and the release check fails. Over SSH this
#    fails ("no user interaction was possible"): run it in Terminal on the Mac's screen, or in
#    Keychain Access → System → DevCat Self-Signed → Trust → Code Signing: Always Trust.
curl -fsSLO https://raw.githubusercontent.com/devileya/DevCat/master/.github/devcat-codesign.crt
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain devcat-codesign.crt
rm devcat-codesign.crt

# 3. Let the runner script Finder: the DMG step (Tauri's bundle_dmg.sh) lays out the installer
#    window with AppleScript. The first build shows "… wants to control Finder" on the Mac's
#    screen: click OK (or System Settings → Privacy & Security → Automation → Finder: on).
#    Unanswered, the AppleScript times out after two minutes ("AppleEvent timed out (-1712)").
```

The signing step (`scripts/ci-macos-signing.sh`) checks the trust before each build. It imports
the certificate into a keychain in the job's temp folder and takes that keychain off the search
list again when the job ends, also when the job fails.

## Security

The repository is public. Only `push` of a `v*` tag and manual runs (`workflow_dispatch`) start
`build.yml`, so only people with write access can run code on the Mac. Keep it that way:

- Don't add `pull_request` triggers to jobs that use the `mac-server` runner.
- Settings → Actions → General → *Approval for running fork pull request workflows*:
  **Require approval for all external contributors**. Otherwise a contributor's fork PR could add
  its own workflow that targets this runner.

## Maintenance

- Status: `cd ~/actions-runner && ./svc.sh status`. Logs: `~/actions-runner/_diag/`.
- The runner updates itself. Disk: `~/actions-runner/_work` (checkouts, each job starts clean)
  and `~/actions-runner/_work/_tool` (Node, pnpm); Rust is in `~/.rustup` and `~/.cargo`.
- To go back to GitHub's runners, set the macOS `platform` entries in `build.yml` to
  `macos-latest` again.
- Remove: `./svc.sh uninstall && ./config.sh remove --token <removal token>`.
