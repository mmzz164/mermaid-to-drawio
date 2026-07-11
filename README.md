# mermaid-to-drawio

*[日本語版はこちら → README.ja.md](README.ja.md)*

Convert [Mermaid](https://mermaid.js.org/) diagrams into fully **editable** [draw.io](https://www.drawio.com/) (`.drawio`) files — as native shapes, not embedded images.

```
flowchart LR                    ┌────────┐      ┌─────────┐
  A[Write in Mermaid] --> B     │ Write  │ ───> │ Fine-   │     …every node still
  B[Fine-tune in draw.io]       │ in     │      │ tune in │     movable, restylable,
                                │Mermaid │      │ draw.io │     connectable.
                                └────────┘      └─────────┘
```

## Why

Mermaid is the fastest way to *write* a diagram; draw.io is the best place to *polish* one. But exporting Mermaid to SVG/PNG gives you a frozen picture. This tool parses Mermaid source directly and emits **native draw.io shapes (`mxCell`)**, so every node, edge, and label stays editable afterwards. The generated files also import cleanly into Gliffy and Lucidchart.

It is intentionally lightweight: the native converter needs only [dagre](https://github.com/dagrejs/dagre) for layout (~2 MB of `node_modules`, no browser, no puppeteer).

## Supported diagrams

**19 Mermaid diagram kinds convert natively:**

flowchart / graph · erDiagram · sequenceDiagram · stateDiagram(-v2) · classDiagram · pie · gantt · mindmap · journey · timeline · quadrantChart · kanban · packet · xychart · radar · sankey · gitGraph · requirementDiagram · C4 (Context / Container / Component / Dynamic / Deployment)

The few remaining kinds (`block-beta`, `architecture-beta`, `zenuml`) can be converted via the optional png/svg image-embedding mode. Unsupported syntax inside a supported diagram degrades gracefully: it is skipped with a warning and conversion continues. CJK labels work everywhere.

See [tool/README.md](tool/README.md) for the exact syntax coverage per diagram kind.

## Quick start (CLI)

Requires Node.js ≥ 18.

```bash
git clone https://github.com/mmzz164/mermaid-to-drawio.git
cd mermaid-to-drawio/tool
npm install --omit=optional        # native mode only: ~2 MB, no puppeteer

# single diagram → diagram.drawio
node src/cli.js diagram.mmd

# a Markdown doc: every ```mermaid fence becomes one page,
# pages are named after the nearest Markdown heading
node src/cli.js design-doc.md -o design-doc.drawio

# merge several inputs into one multi-page file / pipe XML to stdout
node src/cli.js flow.mmd er.mmd notes.md -o all.drawio
node src/cli.js diagram.mmd -o -
```

Open the result in [app.diagrams.net](https://app.diagrams.net/), the draw.io desktop app, or import it into Gliffy / Lucidchart.

For png/svg image-embedding mode (needed only for the three unsupported kinds), install the optional dependency:

```bash
npm install --include=optional
npx puppeteer browsers install chrome-headless-shell
```

## Using as a Claude Code skill

This repository doubles as a skill for [Claude Code](https://code.claude.com/docs/): `SKILL.md` teaches Claude how to drive the converter, so you can simply ask things like *"convert this mermaid diagram to draw.io"* or paste a Markdown design doc and get a multi-page `.drawio` back.

```bash
git clone https://github.com/mmzz164/mermaid-to-drawio.git ~/.claude/skills/mermaid-to-drawio
cd ~/.claude/skills/mermaid-to-drawio/tool && npm install --omit=optional
```

Claude Code picks the skill up automatically; it can also be invoked explicitly with `/mermaid-to-drawio`. (The skill instructions in `SKILL.md` are written in Japanese; the tool itself is language-neutral.)

## Repository layout

| Path | Contents |
| --- | --- |
| `tool/` | The converter: CLI (`src/cli.js`), library (`src/index.js`), one parser + renderer per diagram kind |
| `tool/README.md` | Full CLI / library documentation (English) |
| `tool/README.ja.md` | Same documentation in Japanese |
| `tool/test/` | 188 tests, including golden snapshots that pin the output of every diagram kind byte-for-byte |
| `SKILL.md` | Claude Code skill definition (Japanese) |

## Reliability

- **Golden snapshot tests**: one committed input + expected output per diagram kind (`tool/test/fixtures/golden/`); any change to generated output fails CI-style at `npm test`. Intentional changes are blessed with `npm run golden:update`.
- **Runtime XML guard**: the CLI validates the generated XML (escaping, quoting) before writing, so it never produces a file draw.io would refuse to open.
- Output is deterministic — the same input always produces the same bytes (no timestamps, no randomness).

## License

MIT
