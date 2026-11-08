import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectedFootprintPath, layoutFootprintFlow, type FlowGraph } from '../../src/lib/footprintFlowLayout.ts';

const node = (id: string, kind: string, value: number) => ({ id, kind, value, scope: 'scope3', label: { en: id, fi: id }, yearly: [], members: [] });
const link = (source: number, target: number, value: number) => ({ source, target, value, scope: 'scope3', land: 'all', yearly: [] });
const graph: FlowGraph = {
  nodes: [node('group-a', 'group', 60), node('group-b', 'group', 40), node('source-a', 'source', 60), node('source-b', 'source', 40), node('flag', 'scope', 20), node('nonflag', 'scope', 80)],
  links: [link(0, 2, 60), link(1, 3, 40), link(2, 4, 20), link(2, 5, 40), link(3, 5, 40)],
};

test('Sankey layout uses one proportional scale and keeps every node and ribbon inside the canvas', () => {
  const layout = layoutFootprintFlow(graph, 1000, 580);
  for (const node of layout.nodes) {
    assert.ok(node.y >= 0 && node.y + node.height <= 580);
    assert.equal(node.height, node.value * layout.scale);
  }
  for (const link of layout.links) {
    assert.equal(link.width, link.value * layout.scale);
    assert.ok(link.sy - link.width / 2 >= link.sourceNode.y - 1e-9);
    assert.ok(link.sy + link.width / 2 <= link.sourceNode.y + link.sourceNode.height + 1e-9);
    assert.ok(link.ty - link.width / 2 >= link.targetNode.y - 1e-9);
    assert.ok(link.ty + link.width / 2 <= link.targetNode.y + link.targetNode.height + 1e-9);
    assert.ok(!/NaN|Infinity/.test(link.path));
  }
  assert.ok(!connectedFootprintPath(graph, null).active);
});

test('hovering a source traces its full path without highlighting unrelated contributors to shared scopes', () => {
  const active = connectedFootprintPath(graph, 'source-a');
  assert.deepEqual([...active.links].sort(), [0, 2, 3]);
  assert.ok(!active.nodes.has(1) && !active.nodes.has(3));
  const end = connectedFootprintPath(graph, 'nonflag');
  assert.deepEqual([...end.links].sort(), [0, 1, 3, 4]);
  const ribbon = connectedFootprintPath(graph, null, 2);
  assert.deepEqual([...ribbon.links].sort(), [0, 2]);
});

test('dominant multi-year values cannot squash label spacing or increase chart height', () => {
  const graph: FlowGraph = { nodes: [node('g', 'group', 1e12 + 9), ...Array.from({ length: 10 }, (_, i) => node(`s${i}`, 'source', i ? 1 : 1e12)), node('end', 'scope', 1e12 + 9)], links: [] };
  for (let i = 1; i <= 10; i++) graph.links.push(link(0, i, graph.nodes[i].value), link(i, 11, graph.nodes[i].value));
  const layout = layoutFootprintFlow(graph);
  const activities = layout.nodes.filter((n) => n.kind === 'source').sort((a, b) => a.y - b.y);
  for (let i = 1; i < activities.length; i++) assert.ok(activities[i].y - activities[i - 1].y - activities[i - 1].height >= 35.99);
  assert.equal(layout.height, 580);
  assert.ok(layout.links.every((l) => !/NaN|Infinity/.test(l.path)));
});
