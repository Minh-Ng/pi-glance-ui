import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [readme, packageText, lockText] = await Promise.all([
  readFile("README.md", "utf8"),
  readFile("package.json", "utf8"),
  readFile("package-lock.json", "utf8"),
]);
const packageJson = JSON.parse(packageText);
const lockJson = JSON.parse(lockText);
const installRefs = Array.from(
  readme.matchAll(/pi install git:github\.com\/Minh-Ng\/pi-glance-ui@(v\d+\.\d+\.\d+)/g),
  (match) => match[1],
);

if (installRefs.length !== 1) {
  throw new Error(`README must contain exactly one versioned install command; found ${installRefs.length}`);
}

const [installRef] = installRefs;
const tagCheck = spawnSync(
  "git",
  ["rev-parse", "--verify", "--quiet", `refs/tags/${installRef}^{commit}`],
  { stdio: "ignore" },
);
if (tagCheck.error) throw tagCheck.error;
if (tagCheck.status !== 0) {
  throw new Error(`README install ref ${installRef} does not resolve to a local Git tag`);
}

if (
  lockJson.version !== packageJson.version
  || lockJson.packages?.[""]?.version !== packageJson.version
) {
  throw new Error("package.json and package-lock.json versions do not match");
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  const releaseRef = `v${packageJson.version}`;
  if (process.env.GITHUB_REF_NAME !== releaseRef) {
    throw new Error(
      `release tag ${process.env.GITHUB_REF_NAME} does not match package version ${packageJson.version}`,
    );
  }
  if (installRef !== releaseRef) {
    throw new Error(`README install ref ${installRef} does not match release tag ${releaseRef}`);
  }
}

console.log(`release metadata valid: README uses existing ${installRef}`);
