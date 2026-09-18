# Chrome browser automation

opencode is configured with the official **Chrome DevTools MCP**
(`chrome-devtools-mcp`) so the agent can drive a real Chrome: navigate, click,
type, take DOM snapshots and screenshots, read console/network activity, and
record performance traces. This is useful for exercising the editor end-to-end
(drag a layer, run background removal, export a PDF) without a human at the
keyboard.

The setup is machine-wide (in `~/.config/opencode/`) rather than project-local,
because the same browser tooling is handy in any repo.

## What is installed

| Piece            | Location                                                            |
| ---------------- | ------------------------------------------------------------------- |
| MCP config       | `~/.config/opencode/opencode.jsonc` (server name `chrome-devtools`) |
| Node/npx shim    | `~/.local/share/vite-plus/bin/npx` (vite-plus, Linux)               |
| Chrome for Testing | `~/.cache/puppeteer/chrome/linux-<ver>/chrome-linux64/chrome`      |
| Stable Chrome link | `~/.local/share/chrome-devtools/chrome` (symlink to the above)     |
| Extracted libraries | `~/.local/share/chrome-deps/root/usr/lib/x86_64-linux-gnu`        |

The MCP is launched with:

```
~/.local/share/vite-plus/bin/npx -y chrome-devtools-mcp@latest \
  --headless \
  --executablePath ~/.local/share/chrome-devtools/chrome \
  --no-usage-statistics
```

## Why it looks like this (WSL specifics)

opencode runs inside WSL, and three things make the obvious setup fail:

1. **There is no standalone Linux Node.** `node`/`npx` on `PATH` resolve to the
   Windows installs through WSL interop (`/mnt/c/Program Files/nodejs/...`), and
   the `nvm` directory on `PATH` does not exist. The config therefore calls the
   absolute vite-plus `npx` shim, which provides a real Linux Node 24.
2. **Puppeteer auto-detects WSL and picks the Windows Chrome** at
   `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`. It then launches
   it with `--remote-debugging-pipe`, which the WSL interop cannot carry, so the
   browser exits immediately (`Protocol error (Target.setDiscoverTargets):
   Target closed`). Pointing `--executablePath` at a native Linux Chrome avoids
   the auto-detection entirely.
3. **A sysroot Chrome needs shared libraries** that this WSL image lacks
   (`libnss3`, `libnspr4`, `libasound2`). `sudo` needs a password, so instead the
   `.deb`s are downloaded and unpacked into `~/.local/share/chrome-deps` and
   exposed via `LD_LIBRARY_PATH` in the MCP `environment`. See the system-install
   alternative below if you have `sudo`.

Driving the **Windows** Chrome directly is not possible from WSL as-is: Chrome
binds its debug port to loopback only (`--remote-debugging-address=0.0.0.0` is
ignored), and WSL's loopback is separate. It would require mirrored networking
(`.wslconfig` `networkingMode=mirrored`) or a Windows `netsh portproxy`.

## Configuration

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chrome-devtools": {
      "type": "local",
      "command": [
        "/home/corey/.local/share/vite-plus/bin/npx",
        "-y",
        "chrome-devtools-mcp@latest",
        "--headless",
        "--executablePath",
        "/home/corey/.local/share/chrome-devtools/chrome",
        "--no-usage-statistics"
      ],
      "enabled": true,
      "environment": {
        "LD_LIBRARY_PATH": "/home/corey/.local/share/chrome-deps/root/usr/lib/x86_64-linux-gnu"
      }
    }
  }
}
```

Config is read once at startup. **Quit and restart opencode** after changing it;
the running session keeps the old config.

## Reproducing the Chrome install

```sh
# Latest stable Chrome for Testing version
VER=$(curl -s https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['channels']['Stable']['version'])")

DEST="$HOME/.cache/puppeteer/chrome/linux-$VER"
mkdir -p "$DEST"
curl -L --fail -o /tmp/chrome-linux64.zip \
  "https://storage.googleapis.com/chrome-for-testing-public/$VER/linux64/chrome-linux64.zip"
python3 -c "import zipfile; zipfile.ZipFile('/tmp/chrome-linux64.zip').extractall('$DEST')"

mkdir -p "$HOME/.local/share/chrome-devtools"
ln -sf "$DEST/chrome-linux64/chrome" "$HOME/.local/share/chrome-devtools/chrome"

# Missing system libraries, extracted without root
mkdir -p "$HOME/.local/share/chrome-deps/debs"
cd "$HOME/.local/share/chrome-deps/debs"
apt-get download libnss3 libnspr4 libasound2t64
for d in *.deb; do dpkg -x "$d" "$HOME/.local/share/chrome-deps/root"; done
```

`python3` is used instead of `unzip`, which is not installed on this image and
which `@puppeteer/browsers` otherwise requires.

### System-install alternative (no `LD_LIBRARY_PATH`)

With a working `sudo`, install the libraries system-wide and drop both the
`environment` block and the `chrome-deps` directory:

```sh
sudo apt-get install -y libnss3 libnspr4 libasound2t64
```

## Using it

After restarting opencode the agent gains `chrome-devtools_*` tools
(`navigate_page`, `click`, `fill`, `take_snapshot`, `take_screenshot`,
`list_console_messages`, `list_network_requests`, `performance_start_trace`, …).
A typical flow when working on the editor:

```sh
pnpm dev          # start the dev server, note its URL
```

then ask the agent to navigate to that URL and interact with the page.

### Manual smoke test

The package also ships a `chrome-devtools` CLI, handy for checking the install
without opencode:

```sh
export PATH="$HOME/.local/share/vite-plus/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/share/chrome-deps/root/usr/lib/x86_64-linux-gnu"
CHROME="$HOME/.local/share/chrome-devtools/chrome"

npx -y -p chrome-devtools-mcp chrome-devtools start --headless --executablePath "$CHROME"
npx -y -p chrome-devtools-mcp chrome-devtools new_page https://example.com
npx -y -p chrome-devtools-mcp chrome-devtools list_pages
npx -y -p chrome-devtools-mcp chrome-devtools stop
```

`list_pages` should report a page titled `Example Domain`.

## Switching modes

- **Watch the browser (headed):** remove `--headless` from the `command` array.
  WSLg provides a display (`DISPLAY=:0`), so a window opens on the Windows
  desktop. Headless is more reliable and is the default here.
- **Attach to an existing debuggable Chrome:** start Chrome with
  `--remote-debugging-port=9222 --user-data-dir=<dir>` and replace the launch
  flags with `--browserUrl http://127.0.0.1:9222` (drop `--executablePath`).
  From WSL this only reaches a Chrome running *inside* WSL; a Windows-hosted
  Chrome needs mirrored networking or a `netsh portproxy`.
- **Persist the profile:** the default user-data directory is
  `~/.cache/chrome-devtools-mcp/chrome-profile`. Add `--isolated` for a
  throwaway profile that is deleted on exit.

## Privacy

The MCP exposes the contents of the browser (DOM, network, screenshots) to the
model. `--no-usage-statistics` opts out of Google's tool telemetry;
`--no-performance-crux` additionally stops trace URLs being sent to the CrUX API.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Target closed` / `Target.setDiscoverTargets` on first tool call | Puppeteer used the Windows Chrome; the debug pipe cannot cross WSL interop | Ensure `--executablePath` points at the Linux binary |
| `error while loading shared libraries: libnspr4.so` | `LD_LIBRARY_PATH` missing or `chrome-deps` not extracted | Re-run the extraction and confirm the `environment` block |
| `no zip archiver is available` from `@puppeteer/browsers` | `unzip` is not installed | Download the zip and extract with `python3` as above |
| `chrome-devtools_*` tools absent | opencode not restarted | Quit and relaunch opencode |
| `node: command not found` when running the CLI by hand | vite-plus bin not on `PATH` | `export PATH="$HOME/.local/share/vite-plus/bin:$PATH"` |
| Dev server URL unreachable from the browser | Diverging loopback | The browser runs *inside* WSL, so `localhost` reaches the WSL dev server; use the same host the dev server prints |
