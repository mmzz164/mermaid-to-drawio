#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  convertMermaidToDrawio,
  convertManyMermaidToDrawio,
  extractMermaidBlocksWithHeadings,
  findXmlAttributeProblems,
} from "./index.js";

const USAGE = `Usage: mermaid2drawio <input.mmd|input.md> [more inputs...] [options]

Convert Mermaid diagram file(s) to a draw.io (.drawio) file.

Markdown input (.md, or any input containing \`\`\`mermaid fences) is
supported: every mermaid block becomes its own page in one .drawio file,
named after the nearest preceding Markdown heading when there is one.
Multiple input files also merge into one multi-page file.

Modes:
  native (default)  Parse the mermaid source and emit native draw.io shapes.
                    Supports flowchart, erDiagram, sequenceDiagram,
                    stateDiagram, classDiagram, pie, gantt, mindmap, journey,
                    timeline, quadrantChart, kanban, packet, xychart, radar,
                    sankey, gitGraph, requirementDiagram, and C4.
                    Most compatible (draw.io / Gliffy / Lucid).
  png               Render via mermaid-cli and embed as PNG image.
  svg               Render via mermaid-cli and embed as SVG image.

Options:
  -o, --output <file>       Output file path (default: <first input>.drawio).
                            Use "-" to write the XML to stdout.
  -m, --mode <native|png|svg>  Conversion mode (default: native)
  -s, --scale <number>      PNG render scale (default: 2)
  -t, --theme <name>        Mermaid theme: default | dark | forest | neutral (default: default)
  -b, --background <color>  Background color
  -n, --name <name>         Diagram page name (default: derived from input file)
      --stdin               Read mermaid source from stdin
  -h, --help                Show this help
  -v, --version             Show version

Examples:
  mermaid2drawio diagram.mmd                   # native shapes
  mermaid2drawio design-doc.md                 # one page per mermaid block
  mermaid2drawio a.mmd b.mmd doc.md -o all.drawio
  mermaid2drawio diagram.mmd -o -              # XML to stdout
  cat diagram.mmd | mermaid2drawio --stdin -o out.drawio
`;

function parseArgs(argv) {
  const args = {
    inputs: [],
    output: null,
    mode: "native",
    scale: 2,
    theme: "default",
    background: null,
    name: null,
    stdin: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      case "-o":
      case "--output":
        args.output = argv[++i];
        break;
      case "-m":
      case "--mode":
      case "-f":
      case "--format":
        args.mode = argv[++i];
        if (!["native", "svg", "png"].includes(args.mode)) {
          throw new Error(`--mode must be 'native', 'png', or 'svg'`);
        }
        break;
      case "-s":
      case "--scale":
        args.scale = parseFloat(argv[++i]);
        if (!Number.isFinite(args.scale) || args.scale <= 0) {
          throw new Error(`--scale must be a positive number`);
        }
        break;
      case "-t":
      case "--theme":
        args.theme = argv[++i];
        break;
      case "-b":
      case "--background":
        args.background = argv[++i];
        break;
      case "-n":
      case "--name":
        args.name = argv[++i];
        break;
      case "--stdin":
        args.stdin = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new Error(`Unknown option: ${a}`);
        }
        args.inputs.push(a);
    }
  }
  if (args.background === null) {
    args.background = args.mode === "png" ? "white" : "transparent";
  }
  return args;
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.version) {
    const pkg = JSON.parse(
      await fs.readFile(
        new URL("../package.json", import.meta.url),
        "utf8"
      )
    );
    console.log(pkg.version);
    return;
  }

  // Gather page items ({source, defaultName}) from stdin or input files.
  // Markdown inputs (by extension or by containing a ```mermaid fence)
  // contribute one item per fenced block, named after the nearest fresh
  // Markdown heading; plain .mmd files contribute themselves.
  function itemsFromSource(source, base, isMarkdownHint, label) {
    const hasFence = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*mermaid\b/.test(source);
    if (!isMarkdownHint && !hasFence) {
      return [{ source, defaultName: base }];
    }
    const blocks = extractMermaidBlocksWithHeadings(source);
    if (blocks.length === 0) {
      console.error(`Error: no \`\`\`mermaid blocks found in ${label}`);
      process.exit(1);
    }
    return blocks.map((b, i) => ({
      source: b.source,
      defaultName:
        b.heading || (blocks.length > 1 ? `${base}-${i + 1}` : base),
    }));
  }

  let items = [];
  let firstInput = null;
  if (args.stdin) {
    const source = await readStdin();
    items = itemsFromSource(source, "diagram", false, "stdin");
  } else {
    if (args.inputs.length === 0) {
      console.error("Error: input file required (or use --stdin)\n");
      console.error(USAGE);
      process.exit(2);
    }
    firstInput = args.inputs[0];
    for (const input of args.inputs) {
      const source = await fs.readFile(input, "utf8");
      const base = path.basename(input, path.extname(input));
      const isMd = /\.(md|markdown)$/i.test(input);
      items.push(...itemsFromSource(source, base, isMd, input));
    }
  }

  const toStdout = args.output === "-";
  const outputPath =
    !toStdout && args.output
      ? args.output
      : firstInput
        ? path.join(
            path.dirname(firstInput),
            `${path.basename(firstInput, path.extname(firstInput))}.drawio`
          )
        : "diagram.drawio";

  const baseOpts = {
    mode: args.mode,
    scale: args.scale,
    theme: args.theme,
    background: args.background,
    onWarn: (w) => console.error(`warning: ${w}`),
  };

  let xml;
  if (items.length > 1) {
    xml = await convertManyMermaidToDrawio(items, baseOpts);
  } else {
    // Pass an explicit `diagramName` only when the user supplied `--name`.
    // Otherwise hand `defaultDiagramName` to convertMermaidToDrawio so that a
    // front-matter `title:` block can win over the auto-derived basename.
    xml = await convertMermaidToDrawio(items[0].source, {
      ...baseOpts,
      ...(args.name ? { diagramName: args.name } : {}),
      defaultDiagramName: items[0].defaultName,
    });
  }

  // Guard against ever writing invalid XML (e.g. an unescaped HTML label —
  // draw.io refuses to open such a file). This should be unreachable; if it
  // fires, it is a converter bug.
  const problems = findXmlAttributeProblems(xml);
  if (problems.length) {
    console.error(
      `Error: generated invalid drawio XML (converter bug, please report):\n  ` +
        problems.slice(0, 5).join("\n  ")
    );
    process.exit(1);
  }

  if (toStdout) {
    process.stdout.write(xml);
    return;
  }
  await fs.writeFile(outputPath, xml, "utf8");
  console.error(
    items.length > 1
      ? `Wrote ${outputPath} (${items.length} pages)`
      : `Wrote ${outputPath}`
  );
}

main().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
});
