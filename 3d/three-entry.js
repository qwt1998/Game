// The parts of three.js that 3d/scene.js uses. vendor/three-lite.js is this file bundled and minified, so the
// trial page downloads a few hundred KB instead of the whole library. To rebuild it (e.g. after using
// something new from three.js in scene.js, add it here first):
//   npm install --prefix /tmp/three-build three@0.186.1 esbuild@0.28.2
//   NODE_PATH=/tmp/three-build/node_modules /tmp/three-build/node_modules/.bin/esbuild 3d/three-entry.js \
//     --bundle --minify --format=esm --legal-comments=eof --outfile=vendor/three-lite.js
export {
  WebGLRenderer, Scene, Fog, PerspectiveCamera, HemisphereLight, DirectionalLight,
  Mesh, Group, BufferGeometry, BufferAttribute, PlaneGeometry, BoxGeometry, CylinderGeometry, ConeGeometry,
  IcosahedronGeometry, RingGeometry, CircleGeometry, MeshLambertMaterial, MeshBasicMaterial, CanvasTexture,
  Color, Vector3, SRGBColorSpace, PCFShadowMap, DoubleSide, GreaterDepth
} from 'three';
