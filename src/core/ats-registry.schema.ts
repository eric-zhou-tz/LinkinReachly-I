/**
 * Types for `ats-registry.json` — single source for ATS + board URL detection and extension hints.
 */

/** Value-setting strategy for extension fill (aligns with common ATS widget behavior). */
export type AtsDefaultMethod =
  | 'default'
  | 'react'
  | 'dijit'
  | 'defaultWithoutBlur'
  /** Fire a synthetic click after value set (some React inputs only commit on click). */
  | 'reactClick'
  /** Native value descriptor only: minimal events (fragile widgets). */
  | 'setValue'
  /** Check/uncheck + input/change for boolean inputs. */
  | 'selectCheckboxOrRadio'

export type AtsFillTier = 'generic_extension' | 'extension_bespoke'

export type AtsDetectionTier = 'url' | 'dom_only'

export type AtsDomHeuristics = {
  /** If present, second-pass detection may look for these in the document. */
  embedFormActionContains?: string[]
  markerCss?: string[]
}

/** Optional hints for discovering unknown screening fields (label/control/options paths). */
export type AtsFieldDiscovery = {
  /** Limit search to a subtree when set. */
  containerCss?: string
  labelCss?: string
  controlCss?: string
  optionsCss?: string
}

export type AtsRegistryVendor = {
  id: string
  label: string
  /** Regex strings (passed to `RegExp` as-is); first match wins for extraction. */
  urlRegex: string[]
  /**
   * 1-based capture group indices for `[company, jobId]` when a urlRegex matches.
   * Default `[1, 2]` when omitted.
   */
  urlCaptureGroups?: [number, number]
  /** Full-URL regex strings; if any match, this vendor is skipped for the URL. */
  urlsExcluded: string[]
  /** Substring checks on hostname when no urlRegex matches (lowest specificity). */
  hostnameIncludes: string[]
  /** CSS selectors for submit control (Phase A). */
  submitButtonCss: string[]
  /** CSS selectors indicating successful submission (Phase A). */
  submittedSuccessCss: string[]
  defaultMethod: AtsDefaultMethod
  /** Scope generic fill + submit search to first matching element. */
  containerCss: string[]
  proxySubmitButtons: boolean
  fillTier: AtsFillTier
  detectionTier?: AtsDetectionTier
  domHeuristics?: AtsDomHeuristics
  /** Detect embedded ATS widgets on non-ATS hosts (e.g. Greenhouse on corporate sites). */
  embeddedFormCss?: string[]
  /** Long-tail field discovery for custom screening questions (extension / future matcher). */
  fieldDiscovery?: AtsFieldDiscovery[]
}

export type AtsRegistryBoard = {
  id: string
  label: string
  urlRegex: string[]
  /** Optional `[company, jobId]` capture indices (1-based) for board URL regexes. */
  urlCaptureGroups?: [number, number]
  urlsExcluded: string[]
  hostnameIncludes: string[]
}

export type AtsRegistryFile = {
  version: number
  vendors: AtsRegistryVendor[]
  boards: AtsRegistryBoard[]
}
