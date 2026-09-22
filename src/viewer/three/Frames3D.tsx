import { Html } from '@react-three/drei'
import type { LayoutResult } from '../../layout/types.js'
import { CELL } from '../../layout/constants.js'
import type { Palette } from './palette.js'

const LAYER_LABEL: Record<string, string> = {
  actor: 'Actors',
  interface: 'Interface',
  logic: 'Logic',
  data: 'Data',
  external: 'External',
}

/**
 * The furniture that makes the lattice legible: a translucent plane per layer so the strata
 * read as planes rather than as altitudes, a floor tile per module district so a module reads
 * as a block of the city, and ticks along X so the flow axis reads as an ordered sequence
 * rather than as arbitrary space.
 *
 * Without these the map is a cloud of boxes; with them it is a place.
 */
export function Frames3D({ layout, palette }: { layout: LayoutResult; palette: Palette }) {
  const { bounds, layers, modules, columns } = layout

  const padding = 60
  const width = Math.max(bounds.max.x - bounds.min.x, 1) + padding * 2
  const depth = Math.max(bounds.max.z - bounds.min.z, 1) + padding * 2
  const centreX = (bounds.min.x + bounds.max.x) / 2
  const centreZ = (bounds.min.z + bounds.max.z) / 2
  const floorY = bounds.min.y - 70

  return (
    <group>
      {layers.map((plane) => (
        <group key={plane.layer}>
          <mesh position={[centreX, plane.bottom - 14, centreZ]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial
              color={palette.layer[plane.layer]}
              transparent
              opacity={palette.dark ? 0.055 : 0.05}
              depthWrite={false}
            />
          </mesh>
          <Html
            position={[bounds.min.x - padding * 0.6, plane.y, bounds.max.z + padding * 0.7]}
            center
            distanceFactor={520}
            zIndexRange={[10, 0]}
          >
            <div className="scene-layer-label" style={{ color: palette.layer[plane.layer] }}>
              {LAYER_LABEL[plane.layer] ?? plane.layer}
              <span>{plane.nodeCount}</span>
            </div>
          </Html>
        </group>
      ))}

      {modules.map((district) => (
        <group key={district.key}>
          <mesh position={[centreX, floorY, district.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[width, CELL + 22]} />
            <meshBasicMaterial
              color={palette.grid}
              transparent
              opacity={palette.dark ? 0.5 : 0.75}
              depthWrite={false}
            />
          </mesh>
          <Html
            position={[bounds.min.x - padding * 0.5, floorY, district.z]}
            center
            distanceFactor={520}
            zIndexRange={[10, 0]}
          >
            <div className="scene-district-label">{district.name}</div>
          </Html>
        </group>
      ))}

      {columns.map((column) => (
        <Html
          key={column.phase}
          position={[column.x, floorY - 4, bounds.max.z + padding * 0.75]}
          center
          distanceFactor={520}
          zIndexRange={[10, 0]}
        >
          <div className="scene-column-label">{column.label}</div>
        </Html>
      ))}
    </group>
  )
}
