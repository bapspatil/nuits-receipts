import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyPlan,
  bumpVersion,
  classifyCommit,
  commitsSince,
  computePlan,
  extractChangelogEntry,
  latestTag,
  parseConventionalCommit,
  parseVersionArguments,
  planRelease,
  prependChangelog,
  renderChangelogEntry,
  repositoryUrlFromRemote,
  setPackageVersion,
} from "./version.mjs";

const commit = (subject: string, body = "", sha = "a".repeat(40)) => ({
  sha,
  subject,
  body,
});

const SECTIONS = { breaking: [], features: [], ui: [], hotfixes: [] };

describe("semantic version rules", () => {
  test("bumps each semver position and resets the lower ones", () => {
    expect(bumpVersion("1.4.2", "patch")).toBe("1.4.3");
    expect(bumpVersion("1.4.2", "minor")).toBe("1.5.0");
    expect(bumpVersion("1.4.2", "major")).toBe("2.0.0");
    expect(bumpVersion("1.4.2", "none")).toBe("1.4.2");
    expect(() => bumpVersion("1.4", "patch")).toThrow("MAJOR.MINOR.PATCH");
  });

  test("parses type, scope, bang, and breaking footers", () => {
    expect(
      parseConventionalCommit(commit("feat(deck): swipe (NUI-98)"))
    ).toMatchObject({
      type: "feat",
      scope: "deck",
      breaking: false,
      description: "swipe (NUI-98)",
    });
    expect(
      parseConventionalCommit(commit("fix!: drop the legacy route"))
    ).toMatchObject({
      type: "fix",
      scope: null,
      breaking: true,
    });
    expect(
      parseConventionalCommit(
        commit("feat(api): new shape", "BREAKING CHANGE: ids are strings")
      )
    ).toMatchObject({ breaking: true });
    expect(
      parseConventionalCommit(commit("Take back your last swipe (#11)"))
    ).toBeNull();
    expect(parseConventionalCommit(commit("Merge branch main"))).toBeNull();
  });

  test("maps hotfixes to patch, features to minor, breaking to major", () => {
    expect(
      classifyCommit(parseConventionalCommit(commit("fix(deck): idle state")))
    ).toEqual({
      bump: "patch",
      section: "hotfixes",
    });
    expect(
      classifyCommit(parseConventionalCommit(commit("hotfix: close the gate")))
    ).toEqual({
      bump: "patch",
      section: "hotfixes",
    });
    expect(
      classifyCommit(parseConventionalCommit(commit("feat(chat): typing dots")))
    ).toEqual({
      bump: "minor",
      section: "features",
    });
    expect(
      classifyCommit(
        parseConventionalCommit(commit("feat(auth)!: passkeys only"))
      )
    ).toEqual({ bump: "major", section: "breaking" });
  });

  test("routes UI work by scope or style type and keeps its semver level", () => {
    expect(
      classifyCommit(
        parseConventionalCommit(commit("feat(ui): sheen sweep"))
      )
    ).toEqual({
      bump: "minor",
      section: "ui",
    });
    expect(
      classifyCommit(
        parseConventionalCommit(commit("style(glass): hover timing"))
      )
    ).toEqual({ bump: "patch", section: "ui" });
    expect(
      classifyCommit(parseConventionalCommit(commit("perf(ui): memo the rail")))
    ).toEqual({
      bump: "patch",
      section: "ui",
    });
    expect(
      classifyCommit(
        parseConventionalCommit(commit("fix(ui): focus in sheets"))
      )
    ).toEqual({
      bump: "patch",
      section: "hotfixes",
    });
  });

  test("ignores silent types and release commits when planning", () => {
    const plan = planRelease({
      currentVersion: "1.2.3",
      commits: [
        commit("docs(deck): describe the swipe"),
        commit("chore: update bun"),
        commit("refactor(chat): split the composer"),
        commit("chore(release): v1.2.3"),
        commit("test(sheet): keep focus"),
      ],
    });
    expect(plan.bump).toBe("none");
    expect(plan.nextVersion).toBe("1.2.3");
    expect(plan.unclassified).toEqual([]);
  });

  test("takes the highest bump across the range and reports unparsed subjects", () => {
    const plan = planRelease({
      currentVersion: "1.2.3",
      commits: [
        commit("fix(deck): one"),
        commit("Plain subject without a type", "", "b".repeat(40)),
        commit("feat(matches): two"),
        commit("style(glass): three"),
      ],
    });
    expect(plan.bump).toBe("minor");
    expect(plan.nextVersion).toBe("1.3.0");
    expect(plan.sections.features).toHaveLength(1);
    expect(plan.sections.ui).toHaveLength(1);
    expect(plan.sections.hotfixes).toHaveLength(1);
    expect(plan.unclassified).toEqual([
      { sha: "b".repeat(40), subject: "Plain subject without a type" },
    ]);
  });

  test("honours a forced bump and rejects unknown levels", () => {
    const plan = planRelease({
      currentVersion: "1.2.3",
      commits: [commit("fix: tiny")],
      force: "major",
    });
    expect(plan.nextVersion).toBe("2.0.0");
    expect(plan.forced).toBeTrue();
    expect(() =>
      planRelease({ currentVersion: "1.2.3", commits: [], force: "huge" })
    ).toThrow("--force must be one of");
  });
});

describe("changelog rendering", () => {
  const sections = {
    ...SECTIONS,
    features: [parseConventionalCommit(commit("feat(deck): swipe the deck"))],
    hotfixes: [
      parseConventionalCommit(commit("fix: keep focus", "", "c".repeat(40))),
    ],
  };

  test("renders ordered sections with compare and commit links", () => {
    const entry = renderChangelogEntry({
      version: "1.3.0",
      date: "2026-10-10",
      sections,
      repositoryUrl: "https://github.com/example/app",
      previousTag: "v1.2.3",
    });
    expect(entry).toBe(
      [
        "## [1.3.0](https://github.com/example/app/compare/v1.2.3...v1.3.0) (2026-10-10)",
        "",
        "### Features",
        "",
        `- **deck:** swipe the deck ([aaaaaaa](https://github.com/example/app/commit/${"a".repeat(40)}))`,
        "",
        "### Hotfixes",
        "",
        `- keep focus ([ccccccc](https://github.com/example/app/commit/${"c".repeat(40)}))`,
        "",
      ].join("\n")
    );
    expect(entry).not.toContain(String.fromCharCode(0x20_14));
  });

  test("falls back to a plain heading without a repository url", () => {
    const entry = renderChangelogEntry({
      version: "1.3.0",
      date: "2026-10-10",
      sections,
    });
    expect(entry.startsWith("## 1.3.0 (2026-10-10)\n")).toBeTrue();
    expect(entry).toContain("- **deck:** swipe the deck\n");
  });

  test("prepends under the header and keeps older entries", () => {
    const first = prependChangelog(
      "",
      "## 1.1.0 (2026-01-01)\n\n### Features\n\n- one\n"
    );
    expect(first.startsWith("# Changelog\n")).toBeTrue();
    const second = prependChangelog(
      first,
      "## 1.2.0 (2026-02-02)\n\n### Hotfixes\n\n- two\n"
    );
    expect(second.indexOf("## 1.2.0")).toBeLessThan(second.indexOf("## 1.1.0"));
    expect(second.match(/^# Changelog/gm)).toHaveLength(1);
    expect(extractChangelogEntry(second, "1.1.0")).toBe(
      "## 1.1.0 (2026-01-01)\n\n### Features\n\n- one"
    );
    expect(extractChangelogEntry(second, "1.2.0")).not.toContain("1.1.0");
    expect(() => extractChangelogEntry(second, "9.9.9")).toThrow(
      "no entry for 9.9.9"
    );
  });

  test("rewrites only the version line of package.json", () => {
    const source =
      '{\n  "name": "app",\n  "version": "1.0.0",\n  "private": true\n}\n';
    expect(setPackageVersion(source, "1.1.0")).toBe(
      '{\n  "name": "app",\n  "version": "1.1.0",\n  "private": true\n}\n'
    );
    expect(() => setPackageVersion("{}", "1.1.0")).toThrow(
      "no top-level version"
    );
  });

  test("parses the command line and refuses unknown flags", () => {
    expect(parseVersionArguments(["next"])).toEqual({
      command: "next",
      force: null,
      positional: [],
    });
    expect(parseVersionArguments(["apply", "--force", "minor"])).toMatchObject({
      force: "minor",
    });
    expect(parseVersionArguments(["notes", "1.2.3"])).toMatchObject({
      positional: ["1.2.3"],
    });
    expect(() => parseVersionArguments(["next", "--json"])).toThrow(
      "Unknown flag"
    );
    expect(() => parseVersionArguments(["publish"])).toThrow("Usage");
  });
});

describe("git integration", () => {
  const run = (cwd: string, args: string[]) => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
    return result.stdout.trim();
  };
  const makeRepo = () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "version-"));
    run(cwd, ["init", "-q", "-b", "main"]);
    writeFileSync(
      path.join(cwd, "package.json"),
      '{\n  "name": "x",\n  "version": "1.0.0"\n}\n'
    );
    run(cwd, ["add", "."]);
    run(cwd, ["commit", "-q", "-m", "chore: init"]);
    return cwd;
  };
  const addCommit = (cwd: string, message: string) => {
    writeFileSync(path.join(cwd, `${Math.random()}.txt`), message);
    run(cwd, ["add", "."]);
    run(cwd, ["commit", "-q", "-m", message]);
  };

  test("links to commits only for a public repository", () => {
    const cwd = makeRepo();
    try {
      run(cwd, ["remote", "add", "origin", "https://github.com/someone/project.git"]);
      expect(repositoryUrlFromRemote(cwd)).toBe("https://github.com/someone/project");
      run(cwd, ["remote", "set-url", "origin", "git@github.com:someone/project-private.git"]);
      expect(repositoryUrlFromRemote(cwd)).toBe("");
      run(cwd, ["remote", "set-url", "origin", "https://github.com/someone/project-private"]);
      expect(repositoryUrlFromRemote(cwd)).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plants a baseline before the first tag, then bumps from it", () => {
    const cwd = makeRepo();
    try {
      addCommit(cwd, "feat(deck): huge history that must not count");
      const baseline = computePlan({ cwd, today: "2026-10-10" });
      expect(baseline).toMatchObject({
        action: "baseline",
        tag: "v1.0.0",
        previousTag: null,
      });
      expect(latestTag(cwd)).toBeNull();

      run(cwd, ["tag", "v1.0.0"]);
      expect(computePlan({ cwd, today: "2026-10-10" })).toMatchObject({
        action: "skip",
      });

      addCommit(cwd, "fix(deck): patch one");
      addCommit(cwd, "docs: nothing");
      const patch = computePlan({ cwd, today: "2026-10-10" });
      expect(patch).toMatchObject({
        action: "release",
        bump: "patch",
        nextVersion: "1.0.1",
        previousTag: "v1.0.0",
      });
      expect(commitsSince("v1.0.0", cwd)).toHaveLength(2);

      const applied = applyPlan(patch, { cwd });
      expect(applied.changed).toEqual(["package.json", "CHANGELOG.md"]);
      expect(
        JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).version
      ).toBe("1.0.1");
      const changelog = readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
      expect(changelog).toContain("## 1.0.1 (2026-10-10)");
      expect(changelog).toContain("- **deck:** patch one");
      expect(changelog).not.toContain("nothing");

      run(cwd, ["add", "."]);
      run(cwd, ["commit", "-q", "-m", "chore(release): v1.0.1"]);
      run(cwd, ["tag", "v1.0.1"]);
      run(cwd, ["tag", "v1.0.10"]);
      expect(latestTag(cwd)).toBe("v1.0.10");
      expect(computePlan({ cwd, today: "2026-10-10" })).toMatchObject({
        action: "skip",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("the CLI prints a plan and refuses a release without a tag or force", () => {
    const cwd = makeRepo();
    try {
      const script = path.join(import.meta.dir, "version.mjs");
      const next = spawnSync("bun", [script, "next"], {
        cwd,
        encoding: "utf8",
      });
      expect(next.status).toBe(0);
      expect(JSON.parse(next.stdout)).toMatchObject({ action: "baseline" });
      const bad = spawnSync("bun", [script, "apply", "--force", "nope"], {
        cwd,
        encoding: "utf8",
      });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("--force must be one of");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
