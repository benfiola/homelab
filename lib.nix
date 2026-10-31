{ pkgs, system }:
let
  # versions, urls and hashes live in pins.json so tools/pins.ts can refresh them
  pins = builtins.fromJSON (builtins.readFile ./pins.json);

  arch =
    {
      x86_64-linux = "amd64";
      aarch64-linux = "arm64";
    }
    .${system};

  substitute =
    pin: url:
    builtins.replaceStrings
      [ "\${version}" "\${arch}" ]
      [ pin.version (pin.arches.${arch} or arch) ]
      url;

  # installs a release binary that is pinned independently of nixpkgs
  mkTool =
    pname: pin:
    let
      bin = pin.bin or pname;
      raw = pin.unpack == "none";
    in
    pkgs.stdenvNoCC.mkDerivation {
      inherit pname;
      inherit (pin) version;
      src = pkgs.fetchurl {
        url = substitute pin pin.url;
        hash = pin.hashes.${arch};
      };
      dontUnpack = raw;
      nativeBuildInputs = pkgs.lib.optional (pin.unpack == "zip") pkgs.unzip;
      sourceRoot = ".";
      dontFixup = true;
      installPhase = ''
        runHook preInstall
        install -Dm755 ${if raw then "$src" else bin} $out/bin/${bin}
        runHook postInstall
      '';
      meta.mainProgram = bin;
    };
in
{
  tools = builtins.mapAttrs mkTool pins;

  # the cluster's versions: bump these via pins.json (see `just pins`)
  versions = {
    kubernetes = pins.kubectl.version;
    talos = pins.talosctl.version;
  };
}
