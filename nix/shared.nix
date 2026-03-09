{
  pkgs,
  ...
}:
let
  fs = pkgs.lib.fileset;
  node = pkgs.nodejs_22;
  workspaceRoot = ../.;
  fontsConf = pkgs.makeFontsConf {
    fontDirectories = [ pkgs.dejavu_fonts ];
  };

  mkOfflineNodeModules =
    {
      pname,
      src,
    }:
    pkgs.buildNpmPackage {
      inherit pname src;
      version = "0.1.0";
      nodejs = node;
      npmDeps = pkgs.importNpmLock {
        npmRoot = src;
      };
      npmConfigHook = pkgs.importNpmLock.npmConfigHook;
      dontNpmBuild = true;
      dontNpmInstall = true;
      dontNpmPrune = true;
      buildPhase = ''
        runHook preBuild
        runHook postBuild
      '';
      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        cp -R node_modules package-lock.json package.json "$out/"
        runHook postInstall
      '';
    };

  mkWorkspaceCli =
    {
      pname,
      src,
    }:
    pkgs.buildNpmPackage {
      inherit pname src;
      version = "0.1.0";
      nodejs = node;
      npmDeps = pkgs.importNpmLock {
        npmRoot = src;
      };
      npmConfigHook = pkgs.importNpmLock.npmConfigHook;
      npmBuildScript = "build";
      doCheck = false;
      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        cp -R dist node_modules package.json package-lock.json "$out/"
        runHook postInstall
      '';
    };

  workspacePpSource = fs.toSource {
    root = workspaceRoot;
    fileset = fs.unions [
      (workspaceRoot + "/package.json")
      (workspaceRoot + "/package-lock.json")
      (workspaceRoot + "/tsconfig.json")
      (workspaceRoot + "/src")
    ];
  };

  workspaceAutomationSource = fs.toSource {
    root = workspaceRoot;
    fileset = fs.unions [
      (workspaceRoot + "/package.json")
      (workspaceRoot + "/package-lock.json")
      (workspaceRoot + "/tsconfig.json")
      (workspaceRoot + "/src")
    ];
  };

  sparseSource = pkgs.fetchgit {
    url = "https://github.com/microsoft/playwright.git";
    rev = "3a3c4cef8d6df1477d938b81bcbedd8c53e8439d";
    hash = "sha256-TO0KdC8Z8LXmGBoymB68iIFeEu6ZxDrKxZTlQUbyUys=";
    sparseCheckout = [
      "packages/playwright-core"
      "packages/injected"
      "packages/playwright-ct-core"
      "utils"
    ];
  };

  bundleNodeModules = {
    utils = mkOfflineNodeModules {
      pname = "pp-bundle-utils-node-modules";
      src = "${sparseSource}/packages/playwright-core/bundles/utils";
    };

    zip = mkOfflineNodeModules {
      pname = "pp-bundle-zip-node-modules";
      src = "${sparseSource}/packages/playwright-core/bundles/zip";
    };

    mcp = mkOfflineNodeModules {
      pname = "pp-bundle-mcp-node-modules";
      src = "${sparseSource}/packages/playwright-core/bundles/mcp";
    };
  };

  playwrightBase = pkgs.runCommand "pp-playwright-base" { } ''
    set -euo pipefail
    cp -R ${sparseSource} "$out"
    chmod -R u+w "$out"

    cp -R ${bundleNodeModules.utils}/node_modules "$out/packages/playwright-core/bundles/utils/node_modules"
    cp -R ${bundleNodeModules.zip}/node_modules "$out/packages/playwright-core/bundles/zip/node_modules"
    cp -R ${bundleNodeModules.mcp}/node_modules "$out/packages/playwright-core/bundles/mcp/node_modules"
  '';

  workspaceAutomationCli = mkWorkspaceCli {
    pname = "pp-automation-cli";
    src = workspaceAutomationSource;
  };

  workspacePpCli = mkWorkspaceCli {
    pname = "pp-cli";
    src = workspacePpSource;
  };

  mkRunnableCli =
    {
      name,
      builtCli,
      entrypoint,
    }:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [ node ];
      text = ''
        export NODE_PATH=${builtCli}/node_modules''${NODE_PATH:+:$NODE_PATH}
        exec node ${builtCli}/${entrypoint} "$@"
      '';
    };

  ppCli = mkRunnableCli {
    name = "pp";
    builtCli = workspacePpCli;
    entrypoint = "dist/cli.js";
  };

  ppAutomationCli = mkRunnableCli {
    name = "pp-automation";
    builtCli = workspaceAutomationCli;
    entrypoint = "dist/automation_cli.js";
  };

  preparePlaywrightTreeScript = targetDir: ''
    cp -R ${playwrightBase} "${targetDir}"
    chmod -R u+w "${targetDir}"
  '';

  mkPreparedPlaywright =
    {
      name,
      verifyE2e,
    }:
    pkgs.runCommand name
      {
        nativeBuildInputs = [ node ] ++ pkgs.lib.optionals verifyE2e [ pkgs.chromium ];
      }
      ''
        set -euo pipefail
        export HOME="$TMPDIR/home"
        mkdir -p "$HOME"

        ${preparePlaywrightTreeScript "$TMPDIR/playwright"}

        NODE_PATH=${workspaceAutomationCli}/node_modules \
          node ${workspaceAutomationCli}/dist/automation_cli.js build-core --playwright-root "$TMPDIR/playwright" --skip-install

        if [ "${if verifyE2e then "1" else "0"}" = "1" ]; then
          node ${workspaceAutomationCli}/dist/automation_cli.js run-e2e --playwright-root "$TMPDIR/playwright" --chromium-bin "$(command -v chromium)"
        fi

        mkdir -p "$out"
        cp -R "$TMPDIR/playwright/packages" "$out/packages"
      '';
in
{
  inherit
    fontsConf
    mkPreparedPlaywright
    node
    playwrightBase
    ppAutomationCli
    ppCli
    preparePlaywrightTreeScript
    sparseSource
    workspaceAutomationCli
    workspacePpCli
    workspaceRoot
    ;
}
