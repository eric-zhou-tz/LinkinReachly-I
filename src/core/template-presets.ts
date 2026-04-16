/**
 * Built-in connection-note templates (rotation). Placeholders: {firstName}, {company}, {headline}
 * Keep lines reasonably short — LinkedIn personalized invites are capped (~300 chars).
 */

/** Default templates for new installs and “Reset to built-in” behavior. */
export const BUILTIN_DEFAULT_TEMPLATES: string[] = [
  'Hi {firstName} — I noticed your work at {company} and thought it would be worthwhile to connect. Hope you are having a great week.',
  "{firstName}, I came across your profile and your focus as {headline}. I'm connecting with people doing thoughtful work at {company} — would be glad to stay in touch.",
  "Hi {firstName}, I'm intentionally growing my network in and around {company}. No pitch on my side — just a genuine connection if you're open to it.",
  '{firstName} — I respect what you are building at {company}. If you accept connection requests from peers in the space, I would be grateful to connect.',
  'Hi {firstName}, we have not met, but your background at {company} stood out. Would be happy to connect here.',
  '{firstName} — saw your headline ({headline}) and wanted to connect with someone shaping work at {company}. Thanks for considering.'
]

