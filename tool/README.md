# mermaid2drawio

*[日本語版はこちら → README.ja.md](README.ja.md)*

A Node.js CLI that converts Mermaid diagrams into draw.io (`.drawio`) files.

Three conversion modes:

| Mode | Description | Supported diagrams | Compatible tools |
| --- | --- | --- | --- |
| **`native`** (default) | Parses Mermaid and emits **native draw.io shapes (mxCell)** — every node stays individually editable. No puppeteer. | flowchart, erDiagram, sequenceDiagram, stateDiagram(-v2), classDiagram, pie, gantt, mindmap, journey, timeline, quadrantChart, kanban, packet, xychart, radar, sankey, gitGraph, requirementDiagram, C4 | draw.io / Gliffy / Lucidchart, etc. |
| `png` | Renders with mermaid-cli → embeds as a PNG image | all Mermaid diagrams | draw.io |
| `svg` | Renders with mermaid-cli → embeds as an SVG image | all Mermaid diagrams | draw.io |

The only kinds without a native renderer are `block-beta` / `architecture-beta` / `zenuml` (covered by png/svg mode).

> Note: the image-embedding modes (png/svg) run `@mermaid-js/mermaid-cli` (puppeteer + headless Chromium) under the hood, which is heavyweight. When native mode covers your diagram, prefer it — it is faster, stays editable, and is more portable across tools.

Markdown input (a `.md` file containing ```` ```mermaid ```` fences) produces a **multi-page .drawio** with one page per block. Page names come from front-matter `title:` > the nearest preceding Markdown heading > `Page-N`. Passing **multiple input files** also merges them into one multi-page file (pages named after the files).

## Installation

From npm (recommended):

```bash
npx mermaid2drawio diagram.mmd          # run without installing
npm install -g mermaid2drawio           # or install the CLI globally
```

`@mermaid-js/mermaid-cli` is an **optional dependency**. For native mode only, a lightweight install from source is enough (`node_modules` ≈ 2 MB):

```bash
cd mermaid2drawio
npm install --omit=optional
```

To also use png/svg mode you need the full install (with puppeteer, ≈ 500 MB) plus a headless Chrome:

```bash
npm install --include=optional
npx puppeteer browsers install chrome-headless-shell
```

## Usage

```bash
# Native mode (default, recommended)
mermaid2drawio diagram.mmd

# Explicit output path
mermaid2drawio diagram.mmd -o out.drawio

# PNG embedding (for kinds without a native renderer)
mermaid2drawio arch.mmd -m png -o arch.drawio

# From stdin
cat diagram.mmd | mermaid2drawio --stdin -o out.drawio

# Multiple mermaid blocks in Markdown → one multi-page file
mermaid2drawio design-doc.md -o design-doc.drawio

# Merge multiple input files / write XML to stdout
mermaid2drawio flow.mmd er.mmd notes.md -o all.drawio
mermaid2drawio diagram.mmd -o -
```

Page naming for Markdown input: each block's YAML front-matter `title:` > the nearest preceding Markdown heading (each heading names only the first block after it; `#` lines inside code fences are ignored) > `Page-N`.

### Supported syntax (native mode)

**flowchart**
- `flowchart TD` / `TB` / `BT` / `LR` / `RL`
- Per-subgraph `direction X` directives
- Node shapes: `A`, `A[Label]`, `A(Round)`, `A((Circle))`, `A{Diamond}`, `A([Stadium])`, `A[[Subroutine]]`, `A{{Hexagon}}`, `A[/Para/]`, `A[\Trap\]`, `A[(Database)]`
- Edges: `A --> B`, `A --- B`, `A -.-> B`, `A ==> B`, `A --o B` (circle end), `A --x B` (cross end), `A ~~~ B` (invisible / layout-only)
- Bidirectional: `A <--> B`, `A <==> B`, `A <-.-> B`, `A x--x B`, `A o--o B`
- Long arrows: `A ---> B` / `A --------> B` (length has no effect; it is one edge)
- Labeled edges: `A -- text --> B`, `A -->|text| B` (labels may be quoted)
- Multi-edge `&`: `A & B --> C & D` expands to 4 edges
- Multiple statements per line: `A --> B; C --> D`
- Node ids: letters/digits/`_`/`-`/`.` (hierarchical ids like `pkg.Module` are fine)
- Mermaid v10 attribute form: `A@{ shape: cyl, label: "DB" }` (maps the major shapes: `rect/rounded/stadium/pill/circle/ellipse/diamond/rhombus/hex/hexagon/cyl/db/database/parallelogram/trapezoid/subroutine`)
- Markdown emphasis in labels: `**bold**` / `__bold__` → `<b>`, `*italic*` / `_italic_` → `<i>`, `` `code` `` → `<code>`. Single `*`/`_` only italicize when adjacent to a word boundary, so identifiers like `user_id_field` or `1*2*3` pass through untouched.
- Parallel edges between the same pair get distinct exit/entry anchors to avoid overlap
- Styling:
  - `A:::className` suffix assigns a class
  - `classDef className fill:#f00,stroke:#000,color:#fff,stroke-width:3px,...`
  - `class A,B className` attaches a class to existing nodes
  - `style A fill:#xxx,stroke:#xxx,...` styles a single node directly (wins over classes)
  - `style <subgraphId> fill:..` also restyles subgraph frames
  - Recognized CSS-ish properties: `fill` / `stroke` / `color` / `stroke-width` / `stroke-dasharray` / `font-size` / `font-weight` / `font-style` / `opacity`
- Link styling: `linkStyle 0,2 stroke:#f00,stroke-width:2px` / `linkStyle default stroke:#999`
- Self-loops `A --> A` render as a visible loop (exit/entry assigned automatically)
- YAML front matter / `%%{init: ...}%%`: a leading `--- title: ... ---` sets the diagram page name
- Subgraphs: `subgraph Id["Display Name"] ... end` (nested; inner layout optimized independently)

**erDiagram**
- Entity aliases (mermaid v11): `p[Person]` / `a["Customer Account"]` — relations reference the id, the bracket text is displayed
- Relationships: `EntityA ||--o{ EntityB : "label"` etc.
  - Left cardinality: `||` / `|o` / `}o` / `}|` / `o|`
  - Line: `--` (solid / identifying) or `..` (dashed / non-identifying)
  - Right cardinality: `||` / `o|` / `|o` / `o{` / `|{`
- Attribute blocks: `EntityName { type name [PK|FK|UK] "comment" }`
  - Comments render next to the attribute name
  - Type and name column widths adapt to their content
- Self-references (relations to the same entity)
- Dots allowed in entity ids (`pkg.Module`)

**sequenceDiagram**
- `participant X` / `participant X as Alias` / `actor X`; quoted ids too (`participant "User A" as U`)
- `create participant X` / `create actor X` start the participant's lifeline at the creation point; `destroy X` ends its lifeline with an ✕ (matching mermaid)
- Messages: `->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`
- Activation suffixes: `A->>+B: msg` (activate B), `B-->>-A: msg` (deactivate the sender).
  Activation bars are drawn on the lifeline.
- Explicit `activate X` / `deactivate X` draw the same bars
- Self-messages render as a loop arrow
- Fragments: `alt / else / end`, `opt / end`, `loop / end`, `par / and / end`,
  `critical / option / end`, `break / end` (nesting supported)
- Participant groups `box <color> <label> ... end`: draws a frame behind the boxed lifelines. Colors: `rgb()` / `rgba()` / CSS color names / `transparent`
- Background highlights `rect rgb(r,g,b) ... end`: draws a background rectangle spanning the enclosed messages × involved lifelines (`rgba()` alpha becomes opacity; nesting supported)
- Notes: `Note over X[,Y]: ...` / `Note left of X: ...` / `Note right of X: ...`
- `autonumber`: prefixes each message label with `1. 2. 3. ...`
- `title <text>`: sets the diagram page name (lower priority than front matter)

**stateDiagram(-v2)**
- `[*]` pseudo-states render as an `ellipse` (start) / `shape=endState` (end); multiple occurrences don't collide
- Composite `state Outer { ... }` nests; `direction LR/TB` is honored inside composites
- Stereotypes `state X <<fork>>` / `<<join>>` / `<<choice>>` / `<<end>>` map to dedicated shapes (fork/join = thick bars, choice = rhombus)
- Transitions `A --> B : trigger / action`; state descriptions `X : description`
- Single-line `note left of X : text` and multi-line `note left of X` ... `end note`
- `direction LR/TB/BT/RL` at the top level and per composite
- Concurrency: a `--` line inside a composite splits it into parallel regions, stacked vertically with dashed dividers (mermaid's layout)

**classDiagram**
- `class Foo`, `class Foo { ... }`, generics `Foo~T~`
- `namespace Name { class A ... }` grouping frames (classes are laid out inside the frame; relations may cross namespaces)
- Members with `+ - # ~` visibility (parentheses distinguish methods); stereotypes like `<<interface>>` / `<<abstract>>` are kept
- Relations: inheritance `<|--`, realization `..|>`, composition `*--`, aggregation `o--`, association `-->` `<--` `--`, dependency `..>` `<..`, links `..` — drawn with the standard UML arrowheads and line styles
- Cardinalities like `"1"` / `"many"` placed as end labels
- `note "..."` and `note for ClassName "..."`
- Classes render as the UML three-compartment box (name / stereotype / attributes / methods) in a single HTML cell

**pie**
- `pie` / `pie showData` / `pie title <text>` (`title` / `showData` may be on their own lines)
- Data rows: `"Label" : 42.5` (unquoted labels tolerated)
- Slices use draw.io's `mxgraph.basic.pie` shape (12-o'clock start, clockwise, descending by value — same ordering as Mermaid)
- Integer-rounded `%` labels per slice; color-swatch legend on the right (`Label [value]` with `showData`)
- Palette matches Mermaid's default-theme pie1–pie12

**gantt**
- `title` / `dateFormat` (`YYYY` `YY` `MM` `DD` `HH` `mm` `ss` tokens, e.g. `YYYY-MM-DD`) / `section`
- Task rows: `name : [crit,] [active|done,] [milestone,] [id,] start, end`
  - start: a date or `after id1 [id2 ...]` (max end of the referenced tasks); if omitted, the previous task's end
  - end: a date, a duration (`30d` / `2w` / `12h` / `90m` / `30s`), or `until id`
- Bars are placed proportionally on a time axis; section headers + alternating background bands; date ticks + dashed gridlines
- Colors: normal = purple, `active` = light blue, `done` = grey, `crit` = red border; `milestone` = rhombus
- `axisFormat` / `tickInterval` / `todayMarker` / `weekend` are ignored (presentation hints). `excludes` is unsupported (warning). The today marker is intentionally not drawn (it would make output depend on the conversion date)

**mindmap**
- Indentation defines the hierarchy (tab = 4 spaces)
- Node shapes: `text` (default), `[square]`, `(rounded)`, `((circle))`, `)cloud(`, `))bang((` (approximated by a cloud), `{{hexagon}}`. Optional id prefix (`id[text]`, CJK ids fine)
- `::icon(...)` / `::` decoration lines are skipped; multiple roots warn and attach under the first root
- Left-to-right tree layout via dagre (instead of Mermaid's radial layout — same hierarchy, easier to rearrange in draw.io)
- Root = ellipse; each top-level branch gets its own color (depth ≥ 2 nodes are white with branch-colored borders)

**journey**
- `title` / `section` / `task name: score[: actor, actor]`
- Markers placed by score (clamped 1–5): ≥4 green / 3 yellow / ≤2 red; per-actor color dots + legend

**timeline**
- `period : event : event`, continuation lines `: event`, `section` groups
- Horizontal axis + period boxes with events stacked below; colored per section (or per period without sections)

**quadrantChart**
- `x-axis Left --> Right` / `y-axis Bottom --> Top` / `quadrant-1..4 label` / `name: [x, y]` (0–1)
- Four colored quadrants + vertical y-axis labels + labeled points. Point styling (`:::class` etc.) is ignored with a warning

**kanban**
- Top-level indentation = columns, nested = cards. Both `id[text]` and bare text
- `@{ assigned: 'x', ticket: 'y', priority: 'High' }`: priority colors the card border (Very High/High/Low/Very Low); assigned/ticket render as a smaller second line

**packet (packet-beta)**
- `0-15: "Field"` / single bits `16: "Flag"` / relative widths `+16: "Next"`
- 32 bits per row; fields spanning a row split automatically (`(cont.)` label) with start/end bit numbers on each box

**xychart (xychart-beta)**
- `title` / `x-axis [a, b, c]` (categories) or `x-axis min --> max` (numeric) / `y-axis "label" [min --> max]`
- Multiple `bar "name" [..]` / `line "name" [..]` series (bars group within a category; lines are polylines)
- The y axis picks "nice" tick steps automatically; gridlines and a legend included. `horizontal` is unsupported (warns, renders vertically)

**radar (radar-beta)**
- `axis a["A"], b["B"], ...` / `curve x["X"]{v1, v2, ...}` / `min` / `max`
- Polygonal graticule (4 rings) + spokes + axis labels; curves are closed polylines with vertex dots + legend

**sankey (sankey-beta)**
- CSV rows `source,target,value` (commas inside quotes supported)
- Simplified sankey: layers assigned by longest path from the sources; node heights and edge stroke widths proportional to flow (editable regular edges rather than curved ribbons). Cycles produce a warning

**gitGraph**
- `commit` (`id:` / `tag:` / `type: NORMAL|REVERSE|HIGHLIGHT`), `branch name [order: n]` (creates + checks out), `checkout|switch`, `merge branch [id:/tag:]`, `cherry-pick id:"x"`
- Branches = horizontal lanes (colored, labeled on the left). Merges are larger dots, HIGHLIGHT is a square, REVERSE shows ✕, cherry-picks get a dashed edge from the source commit. Commit ids below, tags above
- `gitGraph TB:` / `BT:` warn and render LR

**requirementDiagram**
- `requirement` / `functionalRequirement` / `interfaceRequirement` / `performanceRequirement` / `physicalRequirement` / `designConstraint` / `element` blocks (`id:` `text:` `risk:` `verifymethod:` / `type:` `docref:`)
- Relations `a - satisfies -> b` and the reversed form `b <- satisfies - a` (contains/copies/derives/satisfies/verifies/refines/traces)
- Stereotype header + field rows per box (requirements = blue, elements = green); dashed open arrows labeled `<<type>>`; dagre layout

**C4 (C4Context / C4Container / C4Component / C4Dynamic / C4Deployment)**
- Elements: `Person(_Ext)` / `System(Db|Queue)(_Ext)` / `Container(Db|Queue)(_Ext)` / `Component(Db|Queue)(_Ext)` — conventional C4 colors (Person navy, System blue, Container mid-blue, Component light blue, external grey); Db renders as a cylinder
- Boundaries: `Enterprise_Boundary` / `System_Boundary` / `Container_Boundary` / `Boundary` / `Node` with `{ ... }` nesting. Recursive layout keeps each boundary tightly wrapped around its members
- `Rel` / `BiRel` (direction suffixes like `Rel_D` are ignored), labels + `[technology]`. `$sprite` / `$tags` / `$link` arguments and `UpdateElementStyle` / `LAYOUT` directives are silently ignored

CJK labels work everywhere. UTF-8 BOM input is accepted. Unsupported syntax is skipped with a warning and conversion continues (non-visual directives like `click` are silently ignored).

### Options

| Option | Description | Default |
| --- | --- | --- |
| `-o, --output <file>` | Output file path (`-` writes to stdout) | `<first input>.drawio` |
| `-m, --mode <native\|png\|svg>` | Conversion mode | `native` |
| `-s, --scale <n>` | PNG render scale | `2` |
| `-t, --theme <name>` | `default` / `dark` / `forest` / `neutral` (png/svg only) | `default` |
| `-b, --background <color>` | Background color | per-mode default |
| `-n, --name <name>` | drawio page name | input file basename |
| `--stdin` | Read the source from stdin | — |
| `-h, --help` | Help | — |
| `-v, --version` | Version | — |

## Programmatic use

```js
import {
  convertMermaidToDrawio,
  flowchartToDrawio,     // synchronous (no puppeteer)
  parseMermaidFlowchart, // parser only
} from "mermaid2drawio";

// Native (sync)
const { xml, warnings } = flowchartToDrawio(src);

// Any mode (async)
const xml2 = await convertMermaidToDrawio(src, { mode: "png" });
```

## Tests

```bash
npm test
```

Output for every diagram kind is pinned byte-for-byte by **golden snapshots** (`test/fixtures/golden/*.expected.drawio`). When a renderer change intentionally alters the output:

```bash
npm run golden:update            # regenerate the expected files
git diff test/fixtures/golden/   # review the diff before committing
```

The CLI also validates the generated XML before writing (unescaped attribute values, unbalanced quotes) and exits with an error instead of producing a file draw.io would refuse to open.

## License

MIT
