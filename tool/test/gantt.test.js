import { test } from "node:test";
import assert from "node:assert/strict";

import { parseGantt, buildDateParser } from "../src/gantt-parser.js";
import { ganttToDrawio } from "../src/gantt-to-drawio.js";
import { convertMermaidToDrawio } from "../src/index.js";

const DAY = 24 * 60 * 60 * 1000;

test("buildDateParser handles YYYY-MM-DD and variants", () => {
  const iso = buildDateParser("YYYY-MM-DD");
  assert.equal(iso("2024-01-15"), Date.UTC(2024, 0, 15));
  assert.equal(iso("2024-1-15"), null); // MM is strict two-digit
  const slash = buildDateParser("YYYY/MM/DD");
  assert.equal(slash("2024/02/03"), Date.UTC(2024, 1, 3));
  const compact = buildDateParser("YYYYMMDD");
  assert.equal(compact("20240203"), Date.UTC(2024, 1, 3));
  const dmy = buildDateParser("DD-MM-YYYY");
  assert.equal(dmy("03-02-2024"), Date.UTC(2024, 1, 3));
  const withTime = buildDateParser("YYYY-MM-DD HH:mm");
  assert.equal(withTime("2024-02-03 09:30"), Date.UTC(2024, 1, 3, 9, 30));
});

test("parseGantt reads sections, tags, ids, durations", () => {
  const m = parseGantt(`gantt
  title Plan
  dateFormat YYYY-MM-DD
  section Build
    Design    :done, des, 2024-01-01, 5d
    Implement :active, imp, after des, 10d
  section Ship
    QA        :crit, after imp, 3d
    Release   :milestone, rel, after imp, 0d
`);
  assert.equal(m.title, "Plan");
  assert.deepEqual(m.warnings, []);
  assert.equal(m.sections.length, 2);
  const [build, ship] = m.sections;
  assert.equal(build.name, "Build");
  const des = build.tasks[0];
  assert.equal(des.done, true);
  assert.equal(des.id, "des");
  assert.equal(des.start, Date.UTC(2024, 0, 1));
  assert.equal(des.end, Date.UTC(2024, 0, 1) + 5 * DAY);
  const imp = build.tasks[1];
  assert.equal(imp.active, true);
  assert.equal(imp.start, des.end); // after des
  assert.equal(imp.end, des.end + 10 * DAY);
  const qa = ship.tasks[0];
  assert.equal(qa.crit, true);
  assert.equal(qa.id, null); // 2 items after tag: start, end
  assert.equal(qa.start, imp.end);
  const rel = ship.tasks[1];
  assert.equal(rel.milestone, true);
  assert.equal(rel.start, rel.end);
});

test("parseGantt: start omitted -> previous task's end; until <id>", () => {
  const m = parseGantt(`gantt
  dateFormat YYYY-MM-DD
  A :a, 2024-01-01, 2d
  B :4d
  C :c, 2024-01-10, 1d
  D :2024-01-05, until c
`);
  assert.deepEqual(m.warnings, []);
  const [a, b, c, d] = m.sections[0].tasks;
  assert.equal(b.start, a.end);
  assert.equal(b.end, a.end + 4 * DAY);
  assert.equal(d.end, c.start);
});

test("parseGantt warns on excludes and bad dates", () => {
  const m = parseGantt(`gantt
  dateFormat YYYY-MM-DD
  excludes weekends
  Good :2024-01-01, 1d
  Bad  :not-a-date, 1d
`);
  assert.equal(m.sections[0].tasks.length, 1);
  assert.equal(m.warnings.length, 2);
  assert.match(m.warnings[0], /excludes/);
  assert.match(m.warnings[1], /could not parse date/);
});

test("ganttToDrawio draws bars, milestone rhombus, section rows", () => {
  const { xml, warnings } = ganttToDrawio(`gantt
  title Plan
  dateFormat YYYY-MM-DD
  section Build
    Design    :done, des, 2024-01-01, 5d
    Implement :crit, after des, 10d
    Done      :milestone, after des, 0d
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /value="Plan"/);
  assert.match(xml, /value="Build"/);
  assert.match(xml, /value="Design"/);
  assert.match(xml, /rhombus;/); // milestone
  assert.match(xml, /fillColor=#d6d6d6/); // done
  assert.match(xml, /strokeColor=#ff0000/); // crit
  assert.match(xml, /gantt-grid-0/); // at least one gridline
});

test("gantt bar geometry is proportional to dates", () => {
  const { xml } = ganttToDrawio(`gantt
  dateFormat YYYY-MM-DD
  A :2024-01-01, 2d
  B :2024-01-03, 4d
`);
  const geoms = [...xml.matchAll(/gantt-task-\d+"[^>]*>.*?<mxGeometry x="(\d+)"[^>]*width="(\d+)"/g)];
  assert.equal(geoms.length, 2);
  const [a, b] = geoms.map((g) => ({ x: +g[1], w: +g[2] }));
  // B starts where A ends and is twice as wide.
  assert.ok(Math.abs(a.x + a.w - b.x) <= 2, `A end ${a.x + a.w} ~ B start ${b.x}`);
  assert.ok(Math.abs(b.w - 2 * a.w) <= 3, `B width ${b.w} ~ 2x A width ${a.w}`);
});

test("convertMermaidToDrawio handles gantt natively", async () => {
  const xml = await convertMermaidToDrawio(`gantt
  dateFormat YYYY-MM-DD
  A :2024-01-01, 2d
`);
  assert.match(xml, /<mxfile/);
  assert.doesNotMatch(xml, /data:image/);
});
