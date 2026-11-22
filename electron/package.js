// Builds the Charged Browser desktop app into dist/ (npm run package).
// Builds for the computer you run it on.
import { join } from "node:path";
import { packager } from "@electron/packager";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

const NAME = "Charged Browser";

const paths = await packager({
  dir: ".",
  name: NAME,
  out: "dist",
  overwrite: true,
  asar: true,
  icon: "electron/icon",
  // Only skip these at the top level; packages in node_modules have their
  // own dist/ folders that the app needs.
  ignore: [
    /^\/dist(\/|$)/,
    /^\/chargedgoat1-veadotube(\/|$)/,
    /^\/\.claude(\/|$)/,
    /^\/README\.md$/,
    /^\/electron\/package\.js$/,
  ],
});

// Lock down the built app so it can't be reused as a general Node.js runtime
// or have code injected through debugging flags and environment variables.
for (const dir of paths) {
  const exe =
    process.platform === "win32" ? join(dir, `${NAME}.exe`)
    : process.platform === "darwin" ? join(dir, `${NAME}.app`)
    : join(dir, NAME);

  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: process.platform === "darwin",
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}

console.log(`\n  ⚡ Built: ${paths.join(", ")}\n`);
