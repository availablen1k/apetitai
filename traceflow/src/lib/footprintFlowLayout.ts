// A three-column, value-preserving layout. One scale is shared by every node and ribbon.
// Label space is reserved independently of the data magnitude; tiny flows stay selectable.
export type FlowNode = {
  id: string; kind: string; value: number; label: { en: string; fi: string };
  scope: string; land?: string; color?: string; order?: number; yearly: { year: number | string; value: number }[];
  members: { id: string; label: { en: string; fi: string }; value: number }[];
};
export type FlowLink = { source: number; target: number; value: number; scope: string; land: string; color?: string; yearly: { year: number | string; value: number }[] };
export type FlowGraph = { nodes: FlowNode[]; links: FlowLink[] };

export function layoutFootprintFlow(graph: FlowGraph, width = 1000, height = 580) {
  const nodes = graph.nodes.map((node, index) => ({ ...node, index, x: 0, y: 0, height: 0, width: 12 }));
  const columns = ['group', 'source', 'scope'].map((kind) => nodes.filter((n) => n.kind === kind));
  const rank = (a: FlowNode, b: FlowNode) => b.value - a.value || a.id.localeCompare(b.id);
  columns[0].sort(rank);
  const groupOrder = new Map(columns[0].map((n, i) => [n.index, i]));
  const parent = new Map(graph.links.map((link) => [link.target, link.source]));
  columns[1].sort((a, b) => (groupOrder.get(parent.get(a.index)!) ?? 0) - (groupOrder.get(parent.get(b.index)!) ?? 0) || rank(a, b));
  columns[2].sort((a,b) => (a.order ?? 0) - (b.order ?? 0) || rank(a,b));
  const total = columns[0].reduce((sum, n) => sum + n.value, 0);
  const maxRows = Math.max(1, ...columns.map((column) => column.length));
  const padding = 24;
  const space = height - padding * 2;
  const scale = total > 0 ? Math.max(1, space - (maxRows - 1) * 36) / total : 0;
  const xs = [192, width / 2 - 32, width - 210];
  columns.forEach((column, col) => {
    const gap = column.length > 1 ? (space - total * scale) / (column.length - 1) : 0;
    let y = column.length === 1 ? padding + (space - total * scale) / 2 : padding;
    for (const node of column) {
      node.x = xs[col]; node.y = y; node.height = node.value * scale;
      y += node.height + gap;
    }
  });
  const links = graph.links.map((link, index) => ({ ...link, index, sourceNode: nodes[link.source], targetNode: nodes[link.target], width: link.value * scale, sy: 0, ty: 0, path: '' }));
  for (const node of nodes) {
    let outgoing = 0;
    for (const link of links.filter((l) => l.source === node.index).sort((a, b) => a.targetNode.y - b.targetNode.y)) {
      link.sy = node.y + outgoing + link.width / 2; outgoing += link.width;
    }
    let incoming = 0;
    for (const link of links.filter((l) => l.target === node.index).sort((a, b) => a.sourceNode.y - b.sourceNode.y)) {
      link.ty = node.y + incoming + link.width / 2; incoming += link.width;
    }
  }
  for (const link of links) {
    const x1 = link.sourceNode.x + link.sourceNode.width;
    const x2 = link.targetNode.x;
    const curve = (x2 - x1) * 0.48;
    link.path = `M${x1},${link.sy} C${x1 + curve},${link.sy} ${x2 - curve},${link.ty} ${x2},${link.ty}`;
  }
  return { nodes, links, scale, width, height };
}

// Walk ancestors and descendants separately. Walking back out through a shared destination
// would incorrectly highlight unrelated contributors to the same Scope/FLAG bucket.
export function connectedFootprintPath(graph: FlowGraph, nodeId: string | null, linkIndex?: number) {
  const nodes = new Set<number>();
  const links = new Set<number>();
  const walk = (start: number, forward: boolean) => {
    const queue = [start];
    const visited = new Set<number>();
    while (queue.length) {
      const at = queue.pop()!;
      if (visited.has(at)) continue;
      visited.add(at); nodes.add(at);
      graph.links.forEach((link, index) => {
        if ((forward ? link.source : link.target) !== at) return;
        links.add(index); queue.push(forward ? link.target : link.source);
      });
    }
  };
  if (linkIndex !== undefined && graph.links[linkIndex]) {
    const link = graph.links[linkIndex]; links.add(linkIndex);
    walk(link.source, false); walk(link.target, true);
  } else {
    const index = graph.nodes.findIndex((n) => n.id === nodeId);
    if (index >= 0) { walk(index, false); walk(index, true); }
  }
  return { nodes, links, active: nodes.size > 0 };
}
