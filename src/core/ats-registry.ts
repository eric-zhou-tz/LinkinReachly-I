import registryJson from './ats-registry.json'
import type {
  AtsRegistryBoard,
  AtsRegistryFile,
  AtsRegistryVendor
} from './ats-registry.schema'

export type { AtsRegistryVendor, AtsRegistryBoard, AtsRegistryFile }

const data = registryJson as AtsRegistryFile

export function getAtsRegistry(): AtsRegistryFile {
  return data
}

