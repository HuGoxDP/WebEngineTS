// scripts/changelog-section.mjs
// ============================================================================
// Prints one version's section of CHANGELOG.md — the release notes for that
// version. Used by .github/workflows/release.yml; runnable by hand to preview
// what a release will say before tagging it.
//
//   node scripts/changelog-section.mjs 0.2.0           section for [0.2.0]
//   node scripts/changelog-section.mjs v0.2.0          same; a leading "v" is dropped
//   node scripts/changelog-section.mjs 0.2.0 FILE.md   read FILE.md instead
//   node scripts/changelog-section.mjs --require-empty-unreleased 0.2.0
//                                                      also check [Unreleased] (below)
//
// The section is everything after the "## [0.2.0]" heading (with or without a
// " - <date>" suffix) up to the next "## [" heading, with the "---" rule that
// separates sections trimmed off. The heading itself is left out: the release
// already carries the version as its title. Keep a Changelog ends the file
// with link reference definitions ("[0.2.0]: https://…"), which therefore
// trail the oldest section; they resolve the headings the notes leave out, so
// they are dropped from it. A definition the section's own text refers to is
// appended to its notes instead, wherever in the file it is defined —
// otherwise a "[docs]" link in the newest section, defined at the end of the
// file, would reach the release as literal text.
//
// Exits non-zero when the section is missing or empty. That is deliberate: in
// this project a release without a changelog entry is a mistake, not a release
// with nothing to say — consumers and the benchmark suite read CHANGELOG.md to
// learn what changed, so tagging without moving [Unreleased] into a version
// section would ship a build nobody can find the changes for. Failing here,
// before anything is built, stops that tag from becoming a release at all.
//
// --require-empty-unreleased also fails while "## [Unreleased]" still has
// entries. Cutting a release moves them into the version's section (README,
// "Releasing"), so at a correctly tagged commit [Unreleased] is empty. Entries
// left there mean the move was forgotten, or the tag names a version whose
// section was written for an earlier build — tagging v0.1.0 on a commit with
// a year of [Unreleased] work would publish all of it under notes that
// mention none of it. Headings, rules and blank lines are not entries, so an
// [Unreleased] holding only empty "### Added" headings passes. release.yml
// always passes the flag; pass it by hand to preview the same check.
//
// Only Node built-ins, so the workflow can run it before `npm install`.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node scripts/changelog-section.mjs [--require-empty-unreleased] <version> [CHANGELOG.md]";

/** Under Actions, prefixing "::error::" turns the message into an annotation on the run. */
function fail(message) {
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "error: ";
    console.error(prefix + message);
    process.exit(1);
}

const args = process.argv.slice(2);
const requireEmptyUnreleased = args.includes("--require-empty-unreleased");
const positional = args.filter((arg) => arg !== "--require-empty-unreleased");
if (positional.length < 1 || positional.length > 2 || positional.some((arg) => arg.startsWith("--"))) {
    fail(USAGE);
}

const [rawVersion, fileArg] = positional;
const version = rawVersion.replace(/^v/, "");
const file = fileArg ? resolve(fileArg) : join(ENGINE, "CHANGELOG.md");
const name = basename(file);

let text;
try {
    text = readFileSync(file, "utf8");
} catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
}

// A Windows checkout with core.autocrlf hands us CRLF; normalise so that a
// trailing "\r" can never make a heading fail to match.
const lines = text.replace(/\r\n?/g, "\n").split("\n");

// "## [0.2.0]" or "## [0.2.0] - 2026-10-12". The bracketed text is compared
// whole, so asking for 0.2.0 never picks up a [0.2.0-rc.1] section.
const HEADING = /^## \[([^\]]+)\]/;
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s/;
const isPadding = (line) => line.trim() === "" || line.trim() === "---";

/** Line indexes of every "## [label]" heading whose label passes `match`. */
function headings(match) {
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        const m = HEADING.exec(lines[i]);
        if (m && match(m[1])) found.push(i);
    }
    return found;
}

/** Every link reference definition in the file: a section may refer to any of them. */
const DEFINITIONS = [...new Set(lines.filter((line) => LINK_DEFINITION.test(line)))];

/** The lines under the heading at `start`, trimmed as the header describes. */
function sectionBody(start) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith("## [")) {
            end = i;
            break;
        }
    }

    const body = lines.slice(start + 1, end);
    while (body.length > 0 && (isPadding(body[body.length - 1]) || LINK_DEFINITION.test(body[body.length - 1]))) {
        body.pop();
    }
    while (body.length > 0 && isPadding(body[0])) body.shift();

    const prose = body.join("\n").toLowerCase();
    const referenced = DEFINITIONS.filter(
        (line) => !body.includes(line) && prose.includes(`[${LINK_DEFINITION.exec(line)[1].toLowerCase()}]`),
    );
    if (referenced.length > 0) body.push("", ...referenced);
    return body;
}

const starts = headings((label) => label === version);
if (starts.length === 0) {
    fail(
        `${name} has no "## [${version}]" section. Move the [Unreleased] entries ` +
        `into "## [${version}] - <date>" and commit that before tagging v${version}.`,
    );
}
if (starts.length > 1) {
    fail(`${name} has ${starts.length} "## [${version}]" sections; there must be exactly one.`);
}

if (requireEmptyUnreleased) {
    for (const start of headings((label) => label.toLowerCase() === "unreleased")) {
        const entries = sectionBody(start).filter((line) => !isPadding(line) && !line.trimStart().startsWith("#"));
        if (entries.length > 0) {
            fail(
                `${name} still has entries under "## [Unreleased]" (line ${start + 1}), so v${version} ` +
                `would ship changes its release notes never mention. If they belong to ${version}, ` +
                `move them into its existing "## [${version}]" section and leave [Unreleased] empty. ` +
                `If that section describes an earlier build, release a new version instead: ` +
                `npm version X.Y.Z --no-git-tag-version, rename [Unreleased] to "## [X.Y.Z] - <date>", ` +
                `commit, and tag vX.Y.Z (README, "Releasing").`,
            );
        }
    }
}

const body = sectionBody(starts[0]);
if (body.length === 0) {
    fail(`${name}'s "## [${version}]" section is empty. Say what changed before releasing it.`);
}

process.stdout.write(body.join("\n") + "\n");
