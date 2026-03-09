{ lib, ... }:

{
  imports = [ ./nix ];

  instructions.instructions = lib.mkAfter [
    (
      if builtins.pathExists ./AGENTS.md
      then builtins.readFile ./AGENTS.md
      else ""
    )
  ];
}
