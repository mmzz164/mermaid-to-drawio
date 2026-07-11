import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseErDiagram,
  cardinalitySymbol,
} from "../src/erdiagram-parser.js";
import { erDiagramToDrawio } from "../src/er-to-drawio.js";
import { detectDiagramKind, convertMermaidToDrawio } from "../src/index.js";

test("ER parser: entity ids with dots are accepted", () => {
  const src = `erDiagram
    pkg.Module ||--o{ pkg.Module.Item : has`;
  const m = parseErDiagram(src);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.entities.has("pkg.Module"), true);
  assert.equal(m.entities.has("pkg.Module.Item"), true);
  assert.equal(m.relationships.length, 1);
});

test("erDiagramToDrawio: attribute comments are rendered next to the name", () => {
  const src = `erDiagram
    Customer {
      string name "the full name"
      string id PK "unique id"
    }`;
  const { xml } = erDiagramToDrawio(src);
  // The comment text must appear in the rendered cell value.
  assert.match(xml, /the full name/);
  assert.match(xml, /unique id/);
});

test("detectDiagramKind: erDiagram header", () => {
  assert.equal(detectDiagramKind("erDiagram\n  A ||--|| B : x"), "er");
  assert.equal(detectDiagramKind("flowchart TD\n  A --> B"), "flowchart");
  assert.equal(
    detectDiagramKind("%%{init: ...}%%\nerDiagram\n  A ||--|| B : x"),
    "er"
  );
});

test("ER parser: relationships and entities", () => {
  const src = `erDiagram
    Order ||--o{ Order : "self"
    Order ||--|| Cart : "1:1"
    Cart ||--o{ CartItem : "1:N"
    CartItem }o--|| Product : "N:1"
  `;
  const m = parseErDiagram(src);
  assert.equal(m.relationships.length, 4);
  // self-reference
  assert.equal(m.relationships[0].from, "Order");
  assert.equal(m.relationships[0].to, "Order");
  assert.equal(m.relationships[0].leftCard, "||");
  assert.equal(m.relationships[0].rightCard, "o{");
  assert.equal(m.relationships[0].label, "self");
  // entities auto-created
  for (const name of ["Order", "Cart", "CartItem", "Product"]) {
    assert.ok(m.entities.has(name), `${name} should be an entity`);
  }
});

test("ER parser: entity attribute block", () => {
  const src = `erDiagram
    Order {
        varchar ParentOrderNumber
        bit RobotShortage
        decimal TotalCapacityL
    }
  `;
  const m = parseErDiagram(src);
  const e = m.entities.get("Order");
  assert.equal(e.attributes.length, 3);
  assert.deepEqual(e.attributes[0], {
    type: "varchar",
    name: "ParentOrderNumber",
    keys: [],
    comment: null,
  });
});

test("ER parser: attribute with PK/FK and comment", () => {
  const src = `erDiagram
    User {
        int id PK "primary key"
        varchar email UK
    }
  `;
  const m = parseErDiagram(src);
  const e = m.entities.get("User");
  assert.equal(e.attributes[0].keys[0], "PK");
  assert.equal(e.attributes[0].comment, "primary key");
  assert.equal(e.attributes[1].keys[0], "UK");
});

test("ER parser: non-identifying (dashed) relationship", () => {
  const src = `erDiagram
    A ||..|| B : "weak"
  `;
  const m = parseErDiagram(src);
  assert.equal(m.relationships[0].identifying, false);
});

test("erDiagramToDrawio: emits table shapes and edges", () => {
  const src = `erDiagram
    Order ||--|| Cart : "1:1"
    Order {
        varchar id
    }`;
  const { xml, warnings } = erDiagramToDrawio(src);
  assert.deepEqual(warnings, []);
  assert.match(xml, /shape=table/);
  assert.match(xml, /id="Order"/);
  assert.match(xml, /id="Cart"/);
  assert.match(xml, /id="Order-row-0"/);
  assert.match(xml, /value="varchar"/);
  // Edge
  assert.match(xml, /edge="1"[^/]*source="Order"[^/]*target="Cart"/);
});

test("convertMermaidToDrawio: ER is auto-detected in native mode", async () => {
  const src = `erDiagram
    A ||--|| B : x
  `;
  const xml = await convertMermaidToDrawio(src);
  assert.match(xml, /shape=table/);
  assert.doesNotMatch(xml, /data:image/);
});

test("convertMermaidToDrawio: end-to-end with the user's delivery ER", async () => {
  const src = `erDiagram
    Order ||--o{ Order : "ParentOrderNumber (self-ref)"
    Order ||--|| Cart : "1:1"
    Cart ||--o{ CartItem : "1:N"
    CartItem }o--|| Product : "N:1"
    Order ||--o| DeliveryOrder : "0..1:1"
    DeliveryOrder }o--|| Delivery : "N:1"
    Delivery }o--|| Drone : "N:1"
    Product {
        decimal CapacityL
    }
    Drone {
        decimal MaxCapacityL
    }
    Order {
        varchar ParentOrderNumber
        bit RobotShortage
        decimal TotalCapacityL
        tinyint RequiredRobotCount
    }`;
  const xml = await convertMermaidToDrawio(src);
  for (const name of [
    "Order",
    "Cart",
    "CartItem",
    "Product",
    "DeliveryOrder",
    "Delivery",
    "Drone",
  ]) {
    assert.match(xml, new RegExp(`id="${name}"`));
  }
  // 7 relationships
  const edges = xml.match(/edge="1"/g) || [];
  assert.equal(edges.length, 7);
  // Self-reference exists
  assert.match(xml, /source="Order"[^/]*target="Order"/);
});

test("er parser: entity aliases id[Label] / id[\"Quoted Label\"]", () => {
  const m = parseErDiagram(`erDiagram
  p[Person] {
    string firstName
  }
  a["Customer Account"] ||--o{ d[Delivery-Address] : has
  p ||--|| a : owns
`);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.entities.get("p").label, "Person");
  assert.equal(m.entities.get("a").label, "Customer Account");
  assert.equal(m.entities.get("d").label, "Delivery-Address");
  // Relations reference ids, not labels.
  assert.equal(m.relationships[1].from, "p");
  assert.equal(m.relationships[1].to, "a");
});

test("er renderer: alias labels are displayed, ids stay as cell ids", () => {
  const { xml, warnings } = erDiagramToDrawio(`erDiagram
  p[Person] ||--o{ o[注文] : places
`);
  assert.deepEqual(warnings, []);
  assert.match(xml, /id="p" value="Person"/);
  assert.match(xml, /id="o" value="注文"/);
  assert.match(xml, /source="p" target="o"/);
});
