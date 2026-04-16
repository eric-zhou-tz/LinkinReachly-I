/**
 * First-run defaults: one sample note + minimal sample list so a fresh install is
 * easy to understand and safe to try (demo-* URLs only).
 */

/** Single default connection note for new installs and “Restore sample note”. */
export const SAMPLE_CONNECTION_NOTE =
  'Hi {firstName} — I noticed your work at {company} and would like to connect. Hope you are having a good week.'

/** Back-compat alias: settings store an array of templates; we ship one starter. */
export const DEMO_STARTER_TEMPLATES: string[] = [SAMPLE_CONNECTION_NOTE]

/** Older installs had these four demo templates — migrate to {@link DEMO_STARTER_TEMPLATES} on load. */
export const LEGACY_DEMO_STARTER_FOUR_TEMPLATES: string[] = [
  'Hi {firstName} — I am expanding my network around {company} and noticed your work. No agenda beyond a genuine connection if you are open to it.',
  '{firstName}, your path at {company} stood out ({headline}). I would like to connect with peers doing similar work — happy to compare notes anytime.',
  "Hi {firstName}, I am reaching out from one founder to another — I admire what you are building at {company}. Would be glad to connect.",
  '{firstName} — I saw your role at {company} and thought we might cross paths professionally. A quick connection here would be great.'
]

/**
 * Minimal CSV: header + one fictional row — easiest path to click “Start run”
 * during development without a multi-line paste.
 */
export const DEMO_SEED_CSV = `profileUrl,firstName,company,headline
https://www.linkedin.com/in/demo-avery-chen/,Avery,Northbridge Labs,VP Product
`

/** RIA execution starter (firm / principal / optional ticker + variant columns). */
export const RIA_DEMO_SEED_CSV = `profileUrl,firstName,principal_name,firm_name,company,headline,ticker,message_variant
https://www.linkedin.com/in/demo-avery-chen/,Avery,Avery Chen,Northbridge Labs,Northbridge Labs,VP Product,NVDA,Reaching out as a peer allocator — noticed your lens on quality compounders.
`

/** Influencer execution starter. */
export const INFLUENCER_DEMO_SEED_CSV = `profileUrl,firstName,company,headline
https://www.linkedin.com/in/demo-avery-chen/,Avery,Northbridge Labs,VP Product
`

/** Job-signal execution starter. */
export const JOB_DEMO_SEED_CSV = `profileUrl,firstName,company,headline
https://www.linkedin.com/in/demo-avery-chen/,Avery,Northbridge Labs,VP Product — hiring pipeline
`
