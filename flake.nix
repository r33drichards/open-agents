{
  description = "open-agents local dev stack (MinIO + bucket + web) via process-compose";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          # nixpkgs periodically marks the MinIO build "insecure" (an upstream
          # CVE marker). It's only used as a local dev object store here, so
          # allow it without flipping the global NIXPKGS_ALLOW_INSECURE.
          config.allowInsecurePredicate = p: builtins.elem (p.pname or "") [ "minio" ];
        };

        # Only the dependencies that aren't part of a normal JS toolchain. node
        # and pnpm are intentionally NOT pinned here so the `web` process uses
        # the repo's own pinned pnpm (packageManager in package.json) from your
        # PATH, avoiding a version clash.
        tools = [
          pkgs.minio
          pkgs.minio-client
          pkgs.process-compose
        ];

        # Launcher: put the nix tools on PATH (ahead of the rest), then run
        # process-compose against ./process-compose.yaml from the repo root.
        mkApp =
          args:
          let
            script = pkgs.writeShellScript "oa-stack" ''
              export PATH=${pkgs.lib.makeBinPath tools}:$PATH
              exec ${pkgs.process-compose}/bin/process-compose ${args} "$@"
            '';
          in
          {
            type = "app";
            program = "${script}";
          };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = tools;
          shellHook = ''
            echo "open-agents dev tools: minio, mc, process-compose"
            echo "  process-compose up            # full stack (minio + bucket + web)"
            echo "  process-compose up minio minio-setup   # deps only"
          '';
        };

        # `nix run`        -> full stack (minio + bucket + web)
        # `nix run .#deps` -> just minio + bucket (run `pnpm web` yourself)
        apps.default = mkApp "up";
        apps.deps = mkApp "up minio minio-setup";
      }
    );
}
