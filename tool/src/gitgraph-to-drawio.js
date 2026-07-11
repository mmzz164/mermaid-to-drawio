import { escapeXml, round, wrapXml, CATEGORICAL, darken, bodyLines, unquote } from "./drawio-xml.js";
import { visualWidth } from "./text-width.js";

/**
 * Minimal Mermaid gitGraph parser.
 *
 *   gitGraph
 *     commit
 *     commit id: "xyz" tag: "v1.0" type: HIGHLIGHT
 *     branch develop
 *     checkout develop
 *     commit
 *     checkout main
 *     merge develop tag: "v2"
 *     cherry-pick id: "xyz"
 *
 * `gitGraph TB:` / `BT:` orientations are rendered LR with a warning.
 * `order:` on branches is respected for lane ordering.
 */
export function parseGitGraph(source) {
  const warnings = [];
  const commits = []; // {id, branch, seq, tag, type, parents: [ids], label}
  const branches = [{ name: "main", order: 0 }];
  const heads = new Map([["main", null]]);
  const byId = new Map();
  let current = "main";
  let seq = 0;
  let autoId = 0;

  const src = source.replace(/^\uFEFF/, "");
  const header = src.split(/\r?\n/).map((l) => l.trim()).find((l) => /^gitGraph\b/i.test(l));
  if (header && /\b(TB|BT):/i.test(header)) {
    warnings.push("gitGraph TB/BT orientation is not supported; rendered LR");
  }

  function attrs(rest) {
    const out = {};
    const re = /(id|tag|type|msg|parent|order)\s*:\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
    let m;
    while ((m = re.exec(rest))) {
      out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    }
    return out;
  }

  function addCommit({ id, tag, type, parents, branch, label }) {
    const c = {
      id: id || `c${autoId++}`,
      autoId: !id, // no explicit `id:` was given
      branch,
      seq: seq++,
      tag: tag || null,
      type: type || "NORMAL",
      parents: parents.filter(Boolean),
      label: label || null,
    };
    commits.push(c);
    byId.set(c.id, c);
    heads.set(branch, c.id);
    return c;
  }

  for (const { trimmed, lineNo } of bodyLines(source, /^gitGraph\b/i)) {
    let m;
    if (/^(title|accTitle|accDescr|options)\b/i.test(trimmed)) continue;
    if ((m = trimmed.match(/^commit\b(.*)$/i))) {
      const a = attrs(m[1]);
      addCommit({
        id: a.id,
        tag: a.tag,
        type: (a.type || "NORMAL").toUpperCase(),
        parents: [heads.get(current)],
        branch: current,
      });
      continue;
    }
    if ((m = trimmed.match(/^branch\s+([^\s]+)(.*)$/i))) {
      const name = unquote(m[1]);
      const a = attrs(m[2] || "");
      if (!heads.has(name)) {
        branches.push({ name, order: a.order !== undefined ? parseFloat(a.order) : branches.length });
        heads.set(name, heads.get(current)); // branch point
      } else {
        warnings.push(`Line ${lineNo}: branch '${name}' already exists`);
      }
      current = name; // mermaid's `branch` also checks out
      continue;
    }
    if ((m = trimmed.match(/^(checkout|switch)\s+(\S+)$/i))) {
      const name = unquote(m[2]);
      if (!heads.has(name)) {
        warnings.push(`Line ${lineNo}: checkout of unknown branch '${name}'`);
        continue;
      }
      current = name;
      continue;
    }
    if ((m = trimmed.match(/^merge\s+(\S+)(.*)$/i))) {
      const other = unquote(m[1]);
      if (!heads.has(other)) {
        warnings.push(`Line ${lineNo}: merge of unknown branch '${other}'`);
        continue;
      }
      const a = attrs(m[2] || "");
      addCommit({
        id: a.id,
        tag: a.tag,
        type: "MERGE",
        parents: [heads.get(current), heads.get(other)],
        branch: current,
      });
      continue;
    }
    if ((m = trimmed.match(/^cherry-pick\b(.*)$/i))) {
      const a = attrs(m[1]);
      const srcCommit = a.id ? byId.get(a.id) : null;
      if (!srcCommit) {
        warnings.push(`Line ${lineNo}: cherry-pick of unknown commit id '${a.id ?? ""}'`);
        continue;
      }
      addCommit({
        id: undefined,
        tag: a.tag || `cherry-pick: ${srcCommit.id}`,
        type: "CHERRY_PICK",
        parents: [heads.get(current), srcCommit.id],
        branch: current,
      });
      continue;
    }
    warnings.push(`Line ${lineNo}: could not parse gitGraph line: ${trimmed}`);
  }

  branches.sort((a, b) => a.order - b.order);
  return { commits, branches, warnings };
}

const PITCH_X = 80;
const PITCH_Y = 60;
const MARGIN = 30;
const DOT = 22;

/**
 * Convert a Mermaid gitGraph to draw.io XML: one horizontal lane per
 * branch, commit dots colored by branch, parent edges (same-lane straight,
 * cross-lane elbows for branch/merge), commit ids below, tags above.
 */
export function gitGraphToDrawio(mermaidSource, opts = {}) {
  const { diagramName = "Page-1" } = opts;
  const model = parseGitGraph(mermaidSource);
  const warnings = [...model.warnings];
  const cells = [];
  if (model.commits.length === 0) {
    warnings.push("gitGraph has no commits");
    return { xml: wrapXml(cells, 850, 1100, diagramName), warnings };
  }

  const lane = new Map(model.branches.map((b, i) => [b.name, i]));
  const laneColor = (name) => CATEGORICAL[lane.get(name) % CATEGORICAL.length];
  const labelW = Math.max(...model.branches.map((b) => visualWidth(b.name) * 7.2)) + 24;
  const x0 = MARGIN + labelW + 20;
  const cx = (c) => x0 + c.seq * PITCH_X + PITCH_X / 2;
  const cy = (c) => MARGIN + lane.get(c.branch) * PITCH_Y + PITCH_Y / 2;
  const byId = new Map(model.commits.map((c) => [c.id, c]));

  // Branch labels on the left.
  model.branches.forEach((b, i) => {
    const color = laneColor(b.name);
    cells.push(
      `<mxCell id="gg-branch-${i}" value="${escapeXml(b.name)}" ` +
        `style="rounded=1;html=1;whiteSpace=wrap;fillColor=${color};strokeColor=${darken(color)};fontColor=#ffffff;fontStyle=1;fontSize=11;" vertex="1" parent="1">` +
        `<mxGeometry x="${MARGIN}" y="${MARGIN + i * PITCH_Y + PITCH_Y / 2 - 12}" width="${round(labelW)}" height="24" as="geometry" />` +
        `</mxCell>`
    );
  });

  // First commit of each branch — used to find fork points.
  const firstOfBranch = new Map();
  for (const c of model.commits) if (!firstOfBranch.has(c.branch)) firstOfBranch.set(c.branch, c);

  // Faint full-width dotted lane guide per branch (mermaid draws these behind
  // the bold coloured branch line, so each lane reads as a continuous track).
  const xEnd = x0 + model.commits.length * PITCH_X;
  model.branches.forEach((b, i) => {
    const y = MARGIN + i * PITCH_Y + PITCH_Y / 2;
    cells.push(
      `<mxCell id="gg-guide-${i}" value="" style="endArrow=none;html=1;dashed=1;dashPattern=1 3;strokeWidth=1;strokeColor=#cccccc;" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${round(x0)}" y="${round(y)}" as="sourcePoint" />` +
        `<mxPoint x="${round(xEnd)}" y="${round(y)}" as="targetPoint" />` +
        `</mxGeometry>` +
        `</mxCell>`
    );
  });

  // Per-branch lane lines span only the branch's ACTIVE range: from its fork
  // point (the parent commit it branched off) to its last commit or the merge
  // that closes it. Mermaid draws the coloured branch line over that interval,
  // not across the whole chart — a full-width line wrongly implies the branch
  // existed before it was created and after it was merged.
  model.branches.forEach((b, i) => {
    const onB = model.commits.filter((c) => c.branch === b.name);
    if (onB.length === 0) return;
    const first = onB[0];
    const last = onB[onB.length - 1];
    const forkParent = first.parents[0] ? byId.get(first.parents[0]) : null;
    const isBase = !forkParent || forkParent.branch === b.name;
    let startX = isBase ? cx(first) : cx(forkParent);
    let endX = cx(last);
    for (const m of model.commits) {
      if (m.type === "MERGE" && byId.get(m.parents[1])?.branch === b.name) endX = Math.max(endX, cx(m));
    }
    const y = MARGIN + i * PITCH_Y + PITCH_Y / 2;
    cells.push(
      `<mxCell id="gg-lane-${i}" value="" style="endArrow=none;html=1;strokeWidth=2;strokeColor=${laneColor(b.name)};" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${round(startX)}" y="${round(y)}" as="sourcePoint" />` +
        `<mxPoint x="${round(endX)}" y="${round(y)}" as="targetPoint" />` +
        `</mxGeometry>` +
        `</mxCell>`
    );
  });

  // Parent edges next (still behind dots). A branch FORK drops at the parent's
  // x then runs along the child lane (like mermaid); a MERGE/other cross-lane
  // edge runs along the parent lane then turns at the child's x.
  let ei = 0;
  for (const c of model.commits) {
    for (const [pi, pid] of c.parents.entries()) {
      const p = byId.get(pid);
      if (!p) continue;
      const x1 = cx(p);
      const y1 = cy(p);
      const x2 = cx(c);
      const y2 = cy(c);
      const dashed = c.type === "CHERRY_PICK" && pid === c.parents[1] ? "dashed=1;" : "";
      const isFork = pi === 0 && p.branch !== c.branch && firstOfBranch.get(c.branch)?.id === c.id;
      let bend = "";
      let color;
      if (y1 === y2) {
        color = laneColor(c.branch);
      } else if (isFork) {
        // Drop straight down at the parent, then run right on the new lane.
        bend = `<Array as="points"><mxPoint x="${round(x1)}" y="${round(y2)}" /></Array>`;
        color = laneColor(c.branch);
      } else {
        // Run along the parent lane, then turn up/down at the child's x.
        bend = `<Array as="points"><mxPoint x="${round(x2)}" y="${round(y1)}" /></Array>`;
        color = laneColor(p.branch);
      }
      cells.push(
        `<mxCell id="gg-e-${ei++}" value="" style="endArrow=none;html=1;rounded=1;strokeWidth=2;strokeColor=${color};${dashed}" edge="1" parent="1">` +
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${round(x1)}" y="${round(y1)}" as="sourcePoint" />` +
          `<mxPoint x="${round(x2)}" y="${round(y2)}" as="targetPoint" />` +
          bend +
          `</mxGeometry>` +
          `</mxCell>`
      );
    }
  }

  // Commit dots, ids, and tags.
  model.commits.forEach((c, i) => {
    const color = laneColor(c.branch);
    const x = cx(c);
    const y = cy(c);
    const isMerge = c.type === "MERGE";
    const size = isMerge ? DOT + 6 : DOT;
    let style;
    if (c.type === "HIGHLIGHT") {
      style = `rounded=0;html=1;fillColor=${color};strokeColor=${darken(color)};strokeWidth=2;`;
    } else if (c.type === "REVERSE") {
      style = `ellipse;html=1;fillColor=#ffffff;strokeColor=${darken(color)};strokeWidth=2;fontStyle=1;`;
    } else if (isMerge) {
      // Merge commits are hollow (white fill, coloured ring) like mermaid.
      style = `ellipse;html=1;fillColor=#ffffff;strokeColor=${color};strokeWidth=3;`;
    } else {
      style = `ellipse;html=1;fillColor=${color};strokeColor=#ffffff;strokeWidth=2;`;
    }
    const value = c.type === "REVERSE" ? "✕" : "";
    cells.push(
      `<mxCell id="gg-c-${i}" value="${escapeXml(value)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(x - size / 2)}" y="${round(y - size / 2)}" width="${size}" height="${size}" as="geometry" />` +
        `</mxCell>`
    );
    // Merge/cherry-pick commits get auto-generated ids that mermaid doesn't
    // print; show a commit-id label only when it carries real information
    // (an explicit id, or a normal/highlight commit).
    const showId = !(c.autoId && (c.type === "MERGE" || c.type === "CHERRY_PICK"));
    if (showId) {
      cells.push(
        `<mxCell id="gg-id-${i}" value="${escapeXml(c.id)}" ` +
          `style="text;html=1;align=center;verticalAlign=top;fontSize=9;fontColor=#666666;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(x - PITCH_X / 2)}" y="${round(y + size / 2 + 2)}" width="${PITCH_X}" height="14" as="geometry" />` +
          `</mxCell>`
      );
    }
    if (c.tag) {
      const tw = Math.max(30, visualWidth(c.tag) * 6.5 + 12);
      cells.push(
        `<mxCell id="gg-tag-${i}" value="${escapeXml(c.tag)}" ` +
          `style="rounded=1;html=1;whiteSpace=wrap;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=9;" vertex="1" parent="1">` +
          `<mxGeometry x="${round(x - tw / 2)}" y="${round(y - size / 2 - 22)}" width="${round(tw)}" height="16" as="geometry" />` +
          `</mxCell>`
      );
    }
  });

  const pageW = x0 + model.commits.length * PITCH_X + MARGIN;
  const pageH = MARGIN * 2 + model.branches.length * PITCH_Y;
  return { xml: wrapXml(cells, pageW, pageH, diagramName), warnings };
}
