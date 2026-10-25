// Reads CHANGELOG.md into structured releases, and holds the link rules the
// docs Changelog page and the site's changelog comic share.
//
// CHANGELOG.md is written by scripts/version.mjs. Its commit and compare links
// point at pages that 404 for visitors, so every reader strips them first.
import { SECTIONS } from './version.mjs';

const COMMIT_OR_COMPARE = /^https:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/(?:commit|compare)\//;

// Pure: drops compare-only lines and trailing commit links, and unlinks any
// other commit or compare link. The docs page depends on this exact output.
export function stripLinks(markdown) {
  let body = markdown;
  // A line that is only a compare link ("[Compare v1 to v2](...)"), with its blank line.
  body = body.replace(/^\[[^\]\n]*\]\(https:\/\/github\.com\/[^)\s]*\/compare\/[^)\s]*\)\n(?:\n)?/gm, '');
  // "([abc1234](https://github.com/o/r/commit/<sha>))" at the end of an entry.
  body = body.replace(/ \(\[[0-9a-f]{7,40}\]\(https:\/\/github\.com\/[^)\s]*\/commit\/[0-9a-f]{7,40}\)\)/g, '');
  // Any other link to a commit or compare page keeps its text only.
  body = body.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, text, url) => (COMMIT_OR_COMPARE.test(url) ? text : all));
  return body;
}

// The newest entry must be the version in package.json, so a release cannot
// ship with a stale changelog page.
export function topVersion(markdown) {
  const match = /^## \[?(\d+\.\d+\.\d+)\b/m.exec(markdown);
  return match ? match[1] : null;
}

export const slugFor = (version) => `v${version.replace(/\./g, '-')}`;

const KINDS = new Map([
  [SECTIONS.breaking, 'breaking'],
  [SECTIONS.features, 'features'],
  [SECTIONS.ui, 'ui'],
  [SECTIONS.hotfixes, 'hotfixes'],
  ['Fixes', 'fixes'],
  ['Documentation and project site', 'docs'],
]);

const HEADING = /^## (?:\[(\d+\.\d+\.\d+)\]\([^)\s]*\)|(\d+\.\d+\.\d+))(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;

function parseEntry(raw) {
  let text = raw.trim();
  let scope = null;
  let label = null;
  let pr = null;
  const scoped = /^\*\*([^*:]+):\*\*\s+/.exec(text);
  if (scoped) {
    scope = scoped[1].trim();
    text = text.slice(scoped[0].length);
  } else {
    const labelled = /^([A-Z][\w-]*(?: [\w-]+){0,2}):\s/.exec(text);
    if (labelled) label = labelled[1];
  }
  const ref = /\s\(#(\d+)\)$/.exec(text);
  if (ref) {
    pr = Number(ref[1]);
    text = text.slice(0, ref.index);
  }
  return { scope, label, text, pr };
}

// Pure: CHANGELOG.md text in, releases newest first out.
export function parseChangelog(markdown, { repo = 'bapspatil/nuits-receipts' } = {}) {
  const lines = stripLinks(markdown.replace(/\r\n?/g, '\n')).split('\n');
  const releases = [];
  const seen = new Set();
  let release = null;
  let section = null;
  let paragraph = [];
  const flush = () => {
    if (paragraph.length && release) {
      const text = paragraph.join(' ');
      if (section) section.entries.push({ scope: null, label: null, text, pr: null });
      else release.intro.push(text);
    }
    paragraph = [];
  };
  lines.forEach((line, i) => {
    if (line.startsWith('## ')) {
      flush();
      const m = HEADING.exec(line);
      if (!m) throw new Error(`CHANGELOG.md:${i + 1}: release heading is not a plain version: ${line}`);
      const version = m[1] ?? m[2];
      if (seen.has(version)) throw new Error(`CHANGELOG.md:${i + 1}: ${version} appears twice.`);
      seen.add(version);
      release = {
        version,
        date: m[3] ?? null,
        slug: slugFor(version),
        intro: [],
        sections: [],
        releaseUrl: `https://github.com/${repo}/releases/tag/v${version}`,
      };
      section = null;
      releases.push(release);
      return;
    }
    if (!release) return; // preamble
    if (line.startsWith('### ')) {
      flush();
      const title = line.slice(4).trim();
      section = { kind: KINDS.get(title) ?? 'other', title, entries: [] };
      release.sections.push(section);
      return;
    }
    if (line.startsWith('- ')) {
      flush();
      if (!section) {
        section = { kind: 'other', title: 'Changes', entries: [] };
        release.sections.push(section);
      }
      section.entries.push(parseEntry(line.slice(2)));
      return;
    }
    if (/^\s{2,}\S/.test(line) && section?.entries.length && !paragraph.length) {
      // A wrapped list item continues the previous entry.
      const last = section.entries[section.entries.length - 1];
      last.text = `${last.text} ${line.trim()}`;
      return;
    }
    if (line.trim() === '') flush();
    else paragraph.push(line.trim());
  });
  flush();
  return releases;
}
