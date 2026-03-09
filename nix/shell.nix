{ config, lib, pkgs, ... }:

let
  shared = import ./shared.nix { inherit pkgs; };
in
{
  env = {
    CHROMIUM_BIN = lib.getExe pkgs.chromium;
    FONTCONFIG_FILE = shared.fontsConf;
    PP_BROWSER = lib.mkDefault "chromium";
  };

  packages = [
    shared.node
    pkgs.typescript
    pkgs.chromium
    pkgs.fontconfig
    pkgs.dejavu_fonts
    pkgs.git
    pkgs.just
  ];

  scripts = {
    check.exec = lib.mkDefault "npm run check";
    test.exec = lib.mkDefault "npm test";
    test-playwright.exec = lib.mkDefault ''
      export CHROMIUM_BIN="${lib.getExe pkgs.chromium}"
      npm run test:playwright
    '';
  };

  enterShell = ''
    echo "Run: npm install"
    echo "Run: check"
    echo "Run: test"
    echo "Run: test-playwright"
  '';

  enterTest = ''
    set -euo pipefail
    node --version
    npm --version
    tsc --version
    chromium --version
  '';
}
