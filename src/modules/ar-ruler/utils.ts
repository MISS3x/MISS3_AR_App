// ============================================================
// AR Ruler Utilities
// Shared math functions for distance, area, and SVG export
// ============================================================

// Utility to calculate Distance between two 3D Vector positions
export const calcDistance = (p1: number[], p2: number[]) => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Utility to calculate Area of 3D Polygon projected onto the X/Z logical floor
export const calcShoelaceArea = (points: {position: number[]}[]): number => {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].position[0] * points[j].position[2];
    area -= points[j].position[0] * points[i].position[2];
  }
  return Math.abs(area) / 2;
};

// SVG String generator for the Area map
export const generateAreaSVG = (nodes: {id: string, position: number[]}[]): string => {
  if (nodes.length < 3) return `<svg viewBox="-5 -5 10 10" xmlns="http://www.w3.org/2000/svg"><text fill="#FFF">Need 3+ points</text></svg>`;
  
  // Map 3D coords to 2D
  let minX = Infinity, maxZ = -Infinity, maxX = -Infinity, minZ = Infinity;
  const mapped = nodes.map(n => {
     // X is right, Z is back (-Z is forward). Map X to X, -Z to Y.
     const x = n.position[0];
     const y = -n.position[2];
     if(x < minX) minX = x;
     if(x > maxX) maxX = x;
     if(y < minZ) minZ = y;
     if(y > maxZ) maxZ = y;
     return {x, y};
  });
  
  const spanX = maxX - minX || 1;
  const spanY = maxZ - minZ || 1;
  const padding = Math.max(spanX, spanY) * 0.2; // 20% padding
  const viewMinX = minX - padding;
  const viewMinY = minZ - padding;
  const viewWidth = spanX + padding * 2;
  const viewHeight = spanY + padding * 2;
  
  const pointsStr = mapped.map(p => `${p.x},${p.y}`).join(' ');

  return `
    <svg viewBox="${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}" xmlns="http://www.w3.org/2000/svg" style="background-color: #0A141E;">
      <defs>
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(0, 255, 255, 0.2)" stroke-width="0.02"/>
        </pattern>
      </defs>
      <rect x="${viewMinX}" y="${viewMinY}" width="${viewWidth}" height="${viewHeight}" fill="url(#grid)" />
      
      <!-- Polygon Footprint -->
      <polygon points="${pointsStr}" fill="rgba(0, 255, 255, 0.2)" stroke="#00FFFF" stroke-width="0.05" />
      
      <!-- Nodes -->
      ${mapped.map(p => `<circle cx="${p.x}" cy="${p.y}" r="0.08" fill="#FFF" />`).join('')}
    </svg>
  `;
};
