{
  description = "homelab development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  
  outputs =
    { nixpkgs, ... }:
    let
      # the devcontainer is linux, even on macOS hosts
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          lib = import ./lib.nix { inherit pkgs system; };
        in
        {
          default = pkgs.mkShell {
            # pinned release binaries (see pins.json): bws, hubble, kubectl, talosctl
            packages =
              (builtins.attrValues lib.tools)
              ++ (with pkgs; [
                curl
                fluxcd
                git
                jsonnet
                jsonnet-bundler
                just
                k9s
                kubernetes-helm
                kustomize
                nixfmt
                nodejs_24
                prettier
                rclone
                renovate
                wireguard-tools
                yq-go
              ]);

            # one source of truth for the cluster's versions (see lib.nix)
            KUBERNETES_VERSION = lib.versions.kubernetes;
            TALOS_VERSION = lib.versions.talos;
          };
        }
      );
    };
}
