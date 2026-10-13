import * as THREE from 'three';

// Shared with the driving physics. Road surfaces are all at y = 0.
export const ROAD_CENTERS = [-160, -80, 0, 80, 160];
export const ROAD_WIDTH = 18;
export const MAP_LIMIT = 205;

/** Build a self-contained, daylight Dehradun streetscape (north is -Z). */
export function createWorld(scene) {
  const root = new THREE.Group();
  root.name = 'Dehradun driving world';
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const batches = new Map();
  let seed = 1979;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const geometry = (value) => { geometries.add(value); return value; };
  const material = (color, options = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...options });
    materials.add(value);
    return value;
  };
  const canvasTexture = (width, height, paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    return texture;
  };

  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = geometry(new THREE.CylinderGeometry(1, 1, 1, 8));
  const crown = geometry(new THREE.IcosahedronGeometry(1, 1));
  const hill = geometry(new THREE.SphereGeometry(1, 16, 10));
  const pyramid = geometry(new THREE.ConeGeometry(1, 1, 4));
  const plane = geometry(new THREE.PlaneGeometry(1, 1));
  const surface = material('#ffffff');
  const leaves = material('#ffffff', { flatShading: true });
  const glass = material('#ffffff', { roughness: 0.65 });
  const white = material('#eee9d8');
  const yellow = material('#e5bf61');
  const bark = material('#7c6952');
  const metal = material('#526562', { metalness: 0.2 });
  const hillMaterial = material('#ffffff', { roughness: 1 });

  function batch(name, shape, mat, castShadow = false) {
    batches.set(name, { shape, mat, castShadow, items: [] });
  }
  batch('pavement', box, surface);
  batch('lawns', box, surface);
  batch('buildings', box, surface, true);
  batch('building trim', box, surface, true);
  batch('windows', box, glass);
  batch('yellow road paint', box, yellow);
  batch('white road paint', box, white);
  batch('tree trunks', cylinder, bark, true);
  batch('tree crowns', crown, leaves, true);
  batch('street furniture', box, metal, true);
  batch('posts', cylinder, metal, true);
  batch('hills', hill, hillMaterial);
  batch('tower roofs', pyramid, surface, true);

  function add(name, x, y, z, sx, sy, sz, color = '#ffffff', rotation = 0) {
    batches.get(name).items.push({ x, y, z, sx, sy, sz, color, rotation });
  }

  // A single merged road mesh. Horizontal strips own intersection squares;
  // vertical strips fill only the spaces between them, so asphalt never z-fights.
  const asphalt = canvasTexture(256, 256, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < image.data.length; i += 4) {
      const tone = 159 + Math.floor(random() * 15);
      image.data[i] = tone;
      image.data[i + 1] = tone + 1;
      image.data[i + 2] = tone;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.anisotropy = 4;
  const roadMaterial = material('#ffffff', { map: asphalt });
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const roadRectangle = (x0, z0, x1, z1) => {
    const offset = positions.length / 3;
    // Counterclockwise when viewed from above.
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]) {
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(x / 7, z / 7);
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  const halfRoad = ROAD_WIDTH / 2;
  const blockRanges = [];
  let previous = -MAP_LIMIT;
  for (const center of ROAD_CENTERS) {
    blockRanges.push([previous, center - halfRoad]);
    previous = center + halfRoad;
    roadRectangle(-MAP_LIMIT, center - halfRoad, MAP_LIMIT, center + halfRoad);
  }
  blockRanges.push([previous, MAP_LIMIT]);
  for (const center of ROAD_CENTERS) {
    for (const [start, end] of blockRanges) {
      roadRectangle(center - halfRoad, start, center + halfRoad, end);
    }
  }
  const roadGeometry = geometry(new THREE.BufferGeometry());
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  roadGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  roadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roadGeometry.setIndex(indices);
  const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
  roadMesh.name = 'Flat road network';
  roadMesh.receiveShadow = true;
  root.add(roadMesh);

  // Grass outside town also gives the distant foothills a continuous base.
  const ground = new THREE.Mesh(geometry(new THREE.PlaneGeometry(1700, 1700)), material('#9dab83'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.035;
  ground.receiveShadow = true;
  root.add(ground);

  function roadPaint(axis, road, along, offset, width, length, name = 'white road paint') {
    if (axis === 'z') add(name, road + offset, 0.009, along, width, 0.012, length);
    else add(name, along, 0.009, road + offset, length, 0.012, width);
  }

  for (const axis of ['x', 'z']) {
    for (const road of ROAD_CENTERS) {
      blockRanges.forEach(([start, end], index) => {
        const paintStart = start + (index > 0 ? 7.2 : 0.5);
        const paintEnd = end - (index < blockRanges.length - 1 ? 7.2 : 0.5);
        for (const offset of [-0.22, 0.22]) {
          roadPaint(axis, road, (paintStart + paintEnd) / 2, offset, 0.13,
            paintEnd - paintStart, 'yellow road paint');
        }
        for (const offset of [-4.5, 4.5]) {
          for (let along = paintStart + 1.5; along + 1.5 < paintEnd; along += 7) {
            roadPaint(axis, road, along, offset, 0.12, 3);
          }
        }
        // Edge paint stays clear of zebra crossings and intersection squares.
        for (const offset of [-8.45, 8.45]) {
          roadPaint(axis, road, (paintStart + paintEnd) / 2, offset, 0.12, paintEnd - paintStart);
        }
        const crossing = (along, direction) => {
          for (let offset = -7.4; offset < 8; offset += 1.85) {
            roadPaint(axis, road, along, offset, 0.85, 2.6);
          }
          // India drives on the left: stop bars cover only the incoming half.
          const incomingSide = axis === 'z' ? -direction : direction;
          roadPaint(axis, road, along + direction * 2.6, incomingSide * 4.4, 7.8, 0.3);
        };
        if (index > 0) crossing(start + 2.6, 1);
        if (index < blockRanges.length - 1) crossing(end - 2.6, -1);
      });
    }
  }

  function tree(x, z, size = 1) {
    // Include foliage radius, not just the trunk, in the roadway clearance.
    if (ROAD_CENTERS.some((c) => Math.abs(x - c) < halfRoad + 2 + 2.5 * size
      || Math.abs(z - c) < halfRoad + 2 + 2.5 * size)) return;
    add('tree trunks', x, 2.05 * size, z, 0.24 * size, 3.8 * size, 0.24 * size);
    const palette = ['#789562', '#688952', '#8da66c', '#547b52'];
    add('tree crowns', x, 4.9 * size, z, 2.5 * size, 3 * size, 2.5 * size,
      palette[Math.floor(random() * palette.length)], random() * Math.PI);
  }

  function building(x, z, width, depth, height, color) {
    const base = 0.2;
    add('buildings', x, base + height / 2, z, width, height, depth, color);
    add('building trim', x, base + height + 0.2, z, width + 0.65, 0.4, depth + 0.65, '#e1d7bc');
    add('building trim', x, base + 0.4, z, width + 0.15, 0.8, depth + 0.15, '#b4ad9a');
    // Roof service box is restrained, with a matching parapet-like roof lip.
    if (height > 12) {
      add('buildings', x + width * 0.15, base + height + 1, z, width * 0.3, 1.4, depth * 0.3, '#c8c2ae');
    }
    for (let y = 2.2; y < height - 1; y += 3.2) {
      for (let offset = -width / 2 + 2; offset < width / 2 - 1; offset += 3.2) {
        const tint = random() > 0.25 ? '#7b9392' : '#a7b4a7';
        for (const sign of [-1, 1]) {
          add('windows', x + offset, y, z + sign * (depth / 2 + 0.025), 1.3, 1.5, 0.045, tint);
        }
      }
      for (let offset = -depth / 2 + 2; offset < depth / 2 - 1; offset += 3.2) {
        for (const sign of [-1, 1]) {
          add('windows', x + sign * (width / 2 + 0.025), y, z + offset, 0.045, 1.5, 1.3, '#839995');
        }
      }
    }
    add('windows', x, 1.45, z + depth / 2 + 0.04, 1.8, 2.5, 0.065, '#526762');
    add('building trim', x, 2.95, z + depth / 2 + 0.65, 3, 0.16, 1.4, '#e2d7bf');
  }

  const facades = ['#d5c6aa', '#cab08f', '#bd8e76', '#b6bca5', '#e0d5bd', '#d2b9a0'];
  blockRanges.forEach(([x0, x1], ix) => {
    blockRanges.forEach(([z0, z1], iz) => {
      const width = x1 - x0;
      const depth = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const plaza = ix === 3 && iz === 2;
      const park = plaza || (ix === 1 && iz === 3) || (ix === 4 && iz === 1);
      // Each sidewalk is wholly contained in its block. The 18 m junction
      // squares remain asphalt, without crossing curbs or overlapping slabs.
      add('pavement', cx, 0.08, cz, width, 0.16, depth, '#d6d0be');
      add('lawns', cx, 0.17, cz, width - 7, 0.02, depth - 7,
        park ? '#a8b983' : '#acb28d');
      // Straight pedestrian paths organize each block and meet its sidewalks.
      add('pavement', cx, 0.185, cz, 2.4, 0.015, depth - 6, '#d4ccb7');
      add('pavement', cx, 0.185, cz, width - 6, 0.015, 2.4, '#d4ccb7');

      for (let x = x0 + 5; x <= x1 - 5; x += 13) {
        tree(x, z0 + 5, 0.85 + random() * 0.2);
        tree(x, z1 - 5, 0.85 + random() * 0.2);
      }
      // Omit corners here, already populated by the horizontal rows.
      for (let z = z0 + 18; z < z1 - 10; z += 13) {
        tree(x0 + 5, z, 0.85 + random() * 0.2);
        tree(x1 - 5, z, 0.85 + random() * 0.2);
      }
      if (park) {
        if (plaza) {
          add('pavement', cx, 0.21, cz, 19, 0.06, 19, '#dcd2b8');
        } else {
          for (const dx of [-13, 13]) {
            for (const dz of [-13, 13]) tree(cx + dx, cz + dz, 1.2);
          }
          add('lawns', cx, 0.27, cz, 9, 0.17, 9, '#8a9f6e');
          tree(cx, cz, 1.35);
        }
        for (const dz of [-10, 10]) {
          for (const dx of [-7, 7]) {
            add('building trim', cx + dx, 0.68, cz + dz, 2.8, 0.16, 0.65, '#a38a68');
            add('building trim', cx + dx, 1.05, cz + dz + 0.3, 2.8, 0.65, 0.12, '#a38a68');
            for (const leg of [-0.9, 0.9]) {
              add('street furniture', cx + dx + leg, 0.4, cz + dz, 0.12, 0.5, 0.5);
            }
          }
        }
      } else {
        const nx = width > 50 ? 2 : 1;
        const nz = depth > 50 ? 2 : 1;
        const cellWidth = (width - 20) / nx;
        const cellDepth = (depth - 20) / nz;
        for (let bx = 0; bx < nx; bx++) {
          for (let bz = 0; bz < nz; bz++) {
            const x = x0 + 10 + (bx + 0.5) * cellWidth;
            const z = z0 + 10 + (bz + 0.5) * cellDepth;
            const height = 6.6 + Math.floor(random() * (ix === 2 || ix === 3 ? 6 : 4)) * 3.2;
            building(x, z, cellWidth * (0.68 + random() * 0.12),
              cellDepth * (0.68 + random() * 0.12), height,
              facades[Math.floor(random() * facades.length)]);
          }
        }
      }
    });
  });

  // A compact clock tower set well inside the landscaped central plaza.
  const towerX = 40;
  const towerZ = -40;
  add('building trim', towerX, 0.43, towerZ, 8, 0.4, 8, '#c5baa0');
  add('buildings', towerX, 5.75, towerZ, 4.4, 10.3, 4.4, '#d8c3a0');
  add('building trim', towerX, 2.15, towerZ, 4.65, 0.35, 4.65, '#f0dfba');
  add('building trim', towerX, 8.6, towerZ, 4.65, 0.35, 4.65, '#f0dfba');
  add('buildings', towerX, 11.55, towerZ, 5.1, 3, 5.1, '#e9d9b8');
  add('building trim', towerX, 13.2, towerZ, 5.65, 0.35, 5.65, '#b58d70');
  add('tower roofs', towerX, 14.8, towerZ, 4.1, 3, 4.1, '#8f7161', Math.PI / 4);
  const clockTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e9d9b8';
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = '#f4ecd3';
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#596459';
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(angle) * 89, 128 + Math.cos(angle) * 89);
      ctx.lineTo(128 + Math.sin(angle) * 100, 128 + Math.cos(angle) * 100);
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(85, 103);
    ctx.lineTo(128, 128);
    ctx.lineTo(188, 94);
    ctx.stroke();
  });
  const clockMaterial = material('#ffffff', { map: clockTexture });
  batch('clock faces', plane, clockMaterial);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    add('clock faces', towerX + Math.sin(angle) * 2.56, 11.65,
      towerZ + Math.cos(angle) * 2.56, 2.4, 2.4, 1, '#ffffff', angle);
  }

  function signTexture(title, subtitle) {
    return canvasTexture(1024, 256, (ctx, w, h) => {
      ctx.fillStyle = '#315e51';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e7e6cb';
      ctx.lineWidth = 5;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff5d8';
      ctx.font = '600 72px sans-serif';
      ctx.fillText(title, w / 2, 113);
      ctx.font = '34px sans-serif';
      ctx.fillStyle = '#dce5ce';
      ctx.fillText(subtitle, w / 2, 185);
    });
  }
  const roadSignMaterial = material('#ffffff', {
    map: signTexture('RAJPUR ROAD', 'DEHRADUN  ·  MUSSOORIE ↑'),
    side: THREE.DoubleSide,
  });
  batch('Rajpur Road signs', plane, roadSignMaterial);
  for (const z of [-116, -36, 44, 124]) {
    const x = 12.2;
    add('posts', x, 1.85, z, 0.075, 3.4, 0.075);
    add('Rajpur Road signs', x, 3.35, z, 4.2, 1.05, 1);
  }
  const welcomeMaterial = material('#ffffff', {
    map: signTexture('DEHRADUN', 'THE DOON VALLEY  ·  UTTARAKHAND'),
  });
  batch('Dehradun welcome sign', plane, welcomeMaterial);
  add('Dehradun welcome sign', -35, 3.3, -185, 10, 2.5, 1);
  for (const x of [-39, -31]) add('posts', x, 1.6, -185, 0.12, 3, 0.12);

  // Rounded, overlapping Himalayan foothills. All hill geometry remains north
  // of the drivable map; a caller's scene fog naturally softens their silhouette.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 9; i++) {
      const x = -560 + i * 140 + (random() - 0.5) * 45;
      const z = -330 - row * 140 - random() * 35;
      add('hills', x, -30, z, 105 + random() * 60,
        90 + row * 25 + random() * 40, 85 + random() * 25,
        ['#8aab8b', '#98b6a0', '#acc4b3'][row]);
    }
  }

  // One draw per material/shape family, regardless of the number of buildings,
  // windows, trees or lane dashes. Static instance data is uploaded just once.
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  for (const [name, { shape, mat, castShadow, items }] of batches) {
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(shape, mat, items.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    items.forEach((item, i) => {
      transform.position.set(item.x, item.y, item.z);
      transform.rotation.set(0, item.rotation, 0);
      transform.scale.set(item.sx, item.sy, item.sz);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, tint.set(item.color));
    });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  batches.clear();
  scene.add(root);

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
      });
      for (const value of geometries) value.dispose();
      for (const value of materials) value.dispose();
      for (const value of textures) value.dispose();
      root.clear();
      geometries.clear();
      materials.clear();
      textures.clear();
    },
  };
}
