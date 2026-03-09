{ pkgs, ... }:

let
  shared = import ./shared.nix { inherit pkgs; };
in
{
  outputs = {
    pp-source = shared.sparseSource;
    pp-base = shared.playwrightBase;
    pp = shared.ppCli;
    pp-cli = shared.ppCli;
    pp-automation = shared.ppAutomationCli;
    pp-automation-cli = shared.ppAutomationCli;

    pp-core = shared.mkPreparedPlaywright {
      name = "pp-core-built";
      verifyE2e = false;
    };

    pp-e2e = pkgs.writeShellApplication {
      name = "pp-e2e";
      runtimeInputs = [
        shared.node
        pkgs.chromium
      ];
      text = ''
        set -euo pipefail
        workdir="$(mktemp -d)"

        ${shared.preparePlaywrightTreeScript "$workdir/playwright"}

        NODE_PATH=${shared.workspaceAutomationCli}/node_modules \
          node ${shared.workspaceAutomationCli}/dist/automation_cli.js build-and-e2e --playwright-root "$workdir/playwright" --chromium-bin "$(command -v chromium)" --skip-install
      '';
    };

    pp-demos = pkgs.writeShellApplication {
      name = "pp-demos";
      runtimeInputs = [
        shared.node
        pkgs.chromium
      ];
      text = ''
        set -euo pipefail
        workdir="$(mktemp -d)"
        outdir="$workdir/demos"

        ${shared.preparePlaywrightTreeScript "$workdir/playwright"}

        NODE_PATH=${shared.workspaceAutomationCli}/node_modules \
          node ${shared.workspaceAutomationCli}/dist/automation_cli.js build-core --playwright-root "$workdir/playwright" --skip-install

        NODE_PATH=${shared.workspaceAutomationCli}/node_modules \
          node ${shared.workspaceAutomationCli}/dist/automation_cli.js run-demos --playwright-root "$workdir/playwright" --chromium-bin "$(command -v chromium)" --output-dir "$outdir"

        echo "demo artifacts: $outdir"
        cat "$outdir/summary.json"
      '';
    };

    pp-specs = pkgs.writeShellApplication {
      name = "pp-specs";
      runtimeInputs = [
        shared.node
        pkgs.chromium
        pkgs.fontconfig
        pkgs.dejavu_fonts
      ];
      text = ''
        set -euo pipefail
        workdir="$(mktemp -d)"
        cp -R ${shared.workspaceRoot} "$workdir/workspace"
        chmod -R u+w "$workdir/workspace"
        cp -R ${shared.workspacePpCli}/node_modules "$workdir/workspace/node_modules"

        cd "$workdir/workspace"
        export XDG_CACHE_HOME="$workdir/xdg-cache"
        export XDG_CONFIG_HOME="$workdir/xdg-config"
        export XDG_DATA_HOME="$workdir/xdg-data"
        export FONTCONFIG_FILE=${shared.fontsConf}
        export CHROMIUM_BIN="$(command -v chromium)"
        ./node_modules/.bin/playwright test --config=playwright.config.ts
      '';
    };
  };
}
