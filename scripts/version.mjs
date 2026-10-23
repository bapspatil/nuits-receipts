#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
/**
 * Semantic-version authority for the release workflow.
 *
 * Reads Conventional Commits since the last `v*` tag, decides the bump, and
 * writes `package.json` plus a CHANGELOG entry grouped as Breaking changes,
 * Features, UI enhancements, and Hotfixes. The GitHub workflow in
 * `.github/workflows/release.yml` runs it; `docs/RELEASING.md`
 * is the operator guide.
 *
 *   bun scripts/version.mjs next   [--force <bump>]   # decide, print JSON
 *   bun scripts/version.mjs apply  [--force <bump>]   # decide and write files
 *   bun scripts/version.mjs notes  <version>           # print one changelog entry
 *
 * Nothing here touches git history or the network: tagging, committing, and
 * publishing stay in the workflow where the token and the approval live.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Commit types that raise the minor version. */
export const MINOR_TYPES = new Set(["feat"]);
/** Commit types that raise the patch version. */
export const PATCH_TYPES = new Set([
  "fix",
  "hotfix",
  "perf",
  "style",
  "revert",
]);
/** Commit types that never move the version on their own. */
export const SILENT_TYPES = new Set([
  "build",
  "chore",
  "ci",
  "copy",
  "docs",
  "refactor",
  "test",
  "update",
]);
/**
 * Scopes whose commits are UI work. A `feat` here still bumps minor; the scope
 * only decides which changelog section the line lands in.
 */
export const UI_SCOPES = new Set([
  "a11y",
  "design",
  "footer",
  "style",
  "ui",
]);

export const SECTIONS = Object.freeze({
  breaking: "Breaking changes",
  features: "Features",
  ui: "UI enhancements",
  hotfixes: "Hotfixes",
});
const SECTION_ORDER = ["breaking", "features", "ui", "hotfixes"];
const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 };
export const BUMPS = Object.freeze(["major", "minor", "patch"]);

const RELEASE_COMMIT_PREFIX = "chore(release):";
const SUBJECT_PATTERN = /^([a-z]+)(?:\(([^()]*)\))?(!)?:\s+(.+)$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;
const SHORT_SHA_LENGTH = 7;
const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";

export const parseSemver = (version) => {
  const match = SEMVER_PATTERN.exec(version ?? "");
  if (!match) {
    throw new Error(`"${version}" is not a plain MAJOR.MINOR.PATCH version.`);
  }
  return match.slice(1, 4).map(Number);
};

export const bumpVersion = (version, bump) => {
  const [major, minor, patch] = parseSemver(version);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "none":
      return version;
    default:
      throw new Error(`Unknown bump "${bump}".`);
  }
};

/**
 * Parse one commit into its conventional parts. Returns null for subjects that
 * do not follow the convention so callers can report them without guessing.
 */
export const parseConventionalCommit = ({ sha = "", subject, body = "" }) => {
  const match = SUBJECT_PATTERN.exec(subject.trim());
  if (!match) {
    return null;
  }
  const [, type, scope, bang, description] = match;
  const breaking = bang === "!" || /^BREAKING[ -]CHANGE:/m.test(body);
  return {
    sha,
    type,
    scope: scope?.trim() || null,
    breaking,
    description: description.trim(),
  };
};

/** Decide the bump level and changelog section for one parsed commit. */
export const classifyCommit = (commit) => {
  if (!commit) {
    return { bump: "none", section: null };
  }
  if (commit.breaking) {
    return { bump: "major", section: "breaking" };
  }
  const isUi = commit.type === "style" || UI_SCOPES.has(commit.scope ?? "");
  if (MINOR_TYPES.has(commit.type)) {
    return { bump: "minor", section: isUi ? "ui" : "features" };
  }
  if (PATCH_TYPES.has(commit.type)) {
    const isFix = commit.type === "fix" || commit.type === "hotfix";
    return { bump: "patch", section: isFix || !isUi ? "hotfixes" : "ui" };
  }
  return { bump: "none", section: null };
};

export const isReleaseCommit = (subject) =>
  subject.trim().startsWith(RELEASE_COMMIT_PREFIX);

/**
 * Fold raw commits into a release plan: the highest bump, the grouped
 * changelog lines, and the subjects the convention could not place.
 */
export const planRelease = ({ currentVersion, commits, force = null }) => {
  const sections = { breaking: [], features: [], ui: [], hotfixes: [] };
  const unclassified = [];
  let bump = "none";
  for (const raw of commits) {
    if (isReleaseCommit(raw.subject)) {
      continue;
    }
    const parsed = parseConventionalCommit(raw);
    if (!parsed) {
      unclassified.push({ sha: raw.sha, subject: raw.subject.trim() });
      continue;
    }
    const { bump: level, section } = classifyCommit(parsed);
    if (BUMP_RANK[level] > BUMP_RANK[bump]) {
      bump = level;
    }
    if (section) {
      sections[section].push(parsed);
    }
  }
  if (force) {
    if (!BUMPS.includes(force)) {
      throw new Error(`--force must be one of ${BUMPS.join(", ")}.`);
    }
    bump = force;
  }
  return {
    currentVersion,
    bump,
    nextVersion: bumpVersion(currentVersion, bump),
    sections,
    unclassified,
    forced: Boolean(force),
  };
};

const commitLink = (repositoryUrl, sha) =>
  repositoryUrl && sha
    ? ` ([${sha.slice(0, SHORT_SHA_LENGTH)}](${repositoryUrl}/commit/${sha}))`
    : "";

/** Render one Keep-a-Changelog style entry. Date is injected for testability. */
export const renderChangelogEntry = ({
  version,
  date,
  sections,
  repositoryUrl = "",
  previousTag = null,
}) => {
  const heading =
    repositoryUrl && previousTag
      ? `## [${version}](${repositoryUrl}/compare/${previousTag}...v${version}) (${date})`
      : `## ${version} (${date})`;
  const blocks = [heading];
  for (const key of SECTION_ORDER) {
    const entries = sections[key] ?? [];
    if (entries.length === 0) {
      continue;
    }
    const lines = entries.map((entry) => {
      const scope = entry.scope ? `**${entry.scope}:** ` : "";
      return `- ${scope}${entry.description}${commitLink(repositoryUrl, entry.sha)}`;
    });
    blocks.push(`### ${SECTIONS[key]}\n\n${lines.join("\n")}`);
  }
  return `${blocks.join("\n\n")}\n`;
};

const CHANGELOG_HEADER = `# Changelog

Generated by \`scripts/version.mjs\` from Conventional Commits on every release.
Do not edit entries by hand; fix the commit message or add a follow-up commit.
`;

/** Insert a new entry under the header, keeping older entries below it. */
export const prependChangelog = (existing, entry) => {
  const source = existing?.trim() ? existing : CHANGELOG_HEADER;
  const firstEntry = source.search(/^## /m);
  if (firstEntry < 0) {
    return `${source.trimEnd()}\n\n${entry}`;
  }
  return `${source.slice(0, firstEntry).trimEnd()}\n\n${entry}\n${source.slice(firstEntry)}`;
};

/** Replace only the version line so package.json keeps its formatting. */
export const setPackageVersion = (source, version) => {
  const pattern = /^(\s*"version":\s*")[^"]+(")/m;
  if (!pattern.test(source)) {
    throw new Error("package.json has no top-level version line.");
  }
  return source.replace(pattern, `$1${version}$2`);
};

const git = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

/** Highest semver `v*` tag reachable from HEAD, or null before the first tag. */
export const latestTag = (cwd) => {
  const tags = git(["tag", "--list", "v*", "--merged", "HEAD"], cwd)
    .split("\n")
    .map((line) => line.trim())
    .filter((tag) => TAG_PATTERN.test(tag));
  if (tags.length === 0) {
    return null;
  }
  tags.sort((a, b) => {
    const [aMajor, aMinor, aPatch] = parseSemver(a.slice(1));
    const [bMajor, bMinor, bPatch] = parseSemver(b.slice(1));
    return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
  });
  return tags.at(-1);
};

/** Non-merge commits after `since` (a tag or ref) up to `until`, oldest first. */
export const commitsSince = (since, cwd, until = "HEAD") => {
  const range = since ? `${since}..${until}` : until;
  const output = git(
    [
      "log",
      "--no-merges",
      "--reverse",
      `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
      range,
    ],
    cwd
  );
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, subject, body = ""] = record.split(FIELD_SEPARATOR);
      return { sha: sha.trim(), subject, body };
    });
};

export const repositoryUrlFromRemote = (cwd) => {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "";
  }
  const remote = result.stdout.trim();
  const match =
    /^git@github\.com:(.+?)(?:\.git)?$/.exec(remote) ??
    /^https:\/\/github\.com\/(.+?)(?:\.git)?$/.exec(remote);
  return match ? `https://github.com/${match[1]}` : "";
};

export const parseVersionArguments = (argv) => {
  const [command, ...rest] = argv;
  const parsed = { command, force: null, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--force") {
      parsed.force = rest[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown flag ${argument}.`);
    } else {
      parsed.positional.push(argument);
    }
  }
  if (!["next", "apply", "notes"].includes(command ?? "")) {
    throw new Error("Usage: version.mjs <next|apply|notes> [--force <bump>]");
  }
  return parsed;
};

/**
 * Compute the plan for the checkout. Before the first tag the current
 * package.json version is the baseline and nothing is bumped, so the first
 * workflow run only plants `v<current>` on main.
 */
export const computePlan = ({ cwd, force = null, today, until = "HEAD" }) => {
  const packagePath = path.join(cwd, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const currentVersion = packageJson.version;
  parseSemver(currentVersion);
  const previousTag = latestTag(cwd);
  const repositoryUrl = repositoryUrlFromRemote(cwd);
  if (!(previousTag || force)) {
    return {
      action: "baseline",
      currentVersion,
      nextVersion: currentVersion,
      tag: `v${currentVersion}`,
      previousTag: null,
      bump: "none",
      sections: { breaking: [], features: [], ui: [], hotfixes: [] },
      unclassified: [],
      repositoryUrl,
      date: today,
    };
  }
  const commits = commitsSince(previousTag, cwd, until);
  const plan = planRelease({ currentVersion, commits, force });
  return {
    action: plan.bump === "none" ? "skip" : "release",
    ...plan,
    tag: `v${plan.nextVersion}`,
    previousTag,
    repositoryUrl,
    date: today,
  };
};

export const applyPlan = (plan, { cwd }) => {
  if (plan.action !== "release") {
    return plan;
  }
  const packagePath = path.join(cwd, "package.json");
  fs.writeFileSync(
    packagePath,
    setPackageVersion(fs.readFileSync(packagePath, "utf8"), plan.nextVersion)
  );
  const changelogPath = path.join(cwd, "CHANGELOG.md");
  const existing = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf8")
    : "";
  const notes = renderChangelogEntry({
    version: plan.nextVersion,
    date: plan.date,
    sections: plan.sections,
    repositoryUrl: plan.repositoryUrl,
    previousTag: plan.previousTag,
  });
  fs.writeFileSync(changelogPath, prependChangelog(existing, notes));
  return { ...plan, notes, changed: ["package.json", "CHANGELOG.md"] };
};

/** The body of one existing CHANGELOG entry, for GitHub release notes. */
export const extractChangelogEntry = (changelog, version) => {
  const escaped = version.replaceAll(".", "\\.");
  const start = changelog.search(
    new RegExp(`^## \\[?${escaped}[\\]\\s(]`, "m")
  );
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no entry for ${version}.`);
  }
  const rest = changelog.slice(start);
  const next = rest.slice(1).search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next + 1)).trim();
};

export const main = ({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
} = {}) => {
  const parsed = parseVersionArguments(argv);
  const today = new Date().toISOString().slice(0, 10);
  if (parsed.command === "notes") {
    const [version] = parsed.positional;
    if (!version) {
      throw new Error("notes requires a version, for example 1.2.3.");
    }
    const changelog = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    return extractChangelogEntry(changelog, version);
  }
  const plan = computePlan({ cwd, force: parsed.force, today });
  return parsed.command === "apply" ? applyPlan(plan, { cwd }) : plan;
};

const isDirectInvocation =
  import.meta.main ||
  (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isDirectInvocation) {
  try {
    const result = main();
    process.stdout.write(
      typeof result === "string"
        ? `${result}\n`
        : `${JSON.stringify(result, null, 2)}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "version command failed"}\n`
    );
    process.exitCode = 1;
  }
}
